import { ffmpegTime } from '../ffmpeg-time.mjs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { samplingKey, type PlainAudioPlan, type PlainExportPlan, type PlainFade, type PlainLayer, type PlainRegion } from '../editor/plain-export';
import { RENDER_X264, plainExportResources, renderResources } from '../render-resources.mjs';
import { reuseMediaFile } from './media-file-cache';
import { forEachLimited } from './run-limited';

const run = promisify(execFile);
type Quality = keyof typeof RENDER_X264;
type SourceInfo = {
  duration: number;
  video?: { codec: string; pixFmt: string; height: number; matrix?: string; range?: string; transfer?: string; primaries?: string; vfr: boolean; alphaTagged: boolean; timeBase?: { num: number; den: number } };
  videoStreams: number; audioStreams: number; audioChannels?: number;
};
type ProbeStream = { codec_type?: string; codec_name?: string; pix_fmt?: string; height?: number; color_space?: string; color_range?: string; color_transfer?: string; color_primaries?: string; r_frame_rate?: string; avg_frame_rate?: string; time_base?: string; channels?: number; disposition?: { attached_pic?: number }; tags?: { alpha_mode?: string } };
type Resources = ReturnType<typeof plainExportResources>;

// Each footage segment is its own short encode, cached on the worker by what it shows, so a
// re-export encodes only changed segments and stream-copies the rest. plainExportResources sizes
// how many encode at once and the threads each gets from the host's CPUs and memory.
// Bump when a segment's pixels would change for the same plan (filters, encoder settings).
export const SEGMENT_FORMAT = 1;

const known = (value?: string) => value && value !== 'unknown' && value !== 'reserved' ? value : undefined;
const rate = (value?: string) => { const [n, d] = (value ?? '').split('/').map(Number); return n > 0 && d > 0 ? n / d : 0; };
const fraction = (value?: string) => { const [num, den] = (value ?? '').split('/').map(Number); return Number.isInteger(num) && Number.isInteger(den) && num > 0 && den > 0 ? { num, den } : undefined; };
// Fixed notation keeps FFmpeg expressions free of exponents and locale effects.
// Filter values keep sub-microsecond precision; time options go through ffmpegTime.
const num = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(12).replace(/\.?0+$/, '');
const expressionNumber = (value: number) => `(${num(value)})`;
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
const lcm = (a: number, b: number) => a / gcd(a, b) * b;

async function probeSource(path: string, signal: AbortSignal): Promise<SourceInfo> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,pix_fmt,height,color_space,color_range,color_transfer,color_primaries,r_frame_rate,avg_frame_rate,time_base,channels:stream_disposition=attached_pic:stream_tags=alpha_mode', '-of', 'json', path], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const value = JSON.parse(stdout) as { format?: { duration?: string }; streams?: ProbeStream[] };
  const streams = value.streams ?? [];
  const videos = streams.filter(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic), audios = streams.filter(stream => stream.codec_type === 'audio');
  const video = videos[0], realFps = rate(video?.r_frame_rate), averageFps = rate(video?.avg_frame_rate);
  return {
    duration: Number(value.format?.duration),
    videoStreams: videos.length, audioStreams: audios.length, audioChannels: audios[0]?.channels,
    ...(video ? { video: {
      codec: video.codec_name ?? '', pixFmt: video.pix_fmt ?? '', height: video.height ?? 0,
      matrix: known(video.color_space), range: known(video.color_range), transfer: known(video.color_transfer), primaries: known(video.color_primaries),
      // HyperFrames' own VFR test (extractMediaMetadata) selects its CFR sampling or VFR resampling.
      vfr: realFps > 0 && averageFps > 0 && Math.abs(realFps - averageFps) / Math.max(realFps, averageFps) > 0.1,
      alphaTagged: video.tags?.alpha_mode === '1',
      timeBase: fraction(video.time_base),
    } } : {}),
  };
}

const MATRICES: Record<string, string> = { bt709: 'bt709', smpte170m: 'smpte170m', bt470bg: 'bt470', fcc: 'fcc', smpte240m: 'smpte240m' };
/** Convert to the browser path's BT.709 limited-range output, reading the source as Chromium would. */
function colorFilters(video: NonNullable<SourceInfo['video']>, width: number, height: number) {
  if (/^(yuva|rgba|bgra|argb|abgr|gbrap|ya)/.test(video.pixFmt) || video.alphaTagged) throw new Error('Fast export does not composite transparent video.');
  if (video.transfer === 'smpte2084' || video.transfer === 'arib-std-b67' || video.primaries === 'bt2020' || video.matrix?.startsWith('bt2020')) throw new Error('Fast export does not tone-map HDR video.');
  // HyperFrames tags untagged sources with Chromium's guess (chromeGuessForUntaggedMatrix).
  const matrix = video.matrix ? MATRICES[video.matrix] : video.height >= 720 && video.codec !== 'vp9' && video.codec !== 'av1' ? 'bt709' : 'smpte170m';
  if (!matrix) throw new Error(`Fast export does not convert the ${video.matrix} color matrix.`);
  const fullRange = video.range === 'pc' || /^yuvj/.test(video.pixFmt);
  if (matrix === 'bt709' && !fullRange) return `scale=${width}:${height},format=yuv420p`;
  return `scale=${width}:${height}:in_color_matrix=${matrix}:in_range=${fullRange ? 'pc' : 'tv'},format=gbrp,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`;
}

type Sampling = Pick<Extract<PlainExportPlan['video'][number], { kind: 'clip' }>, 'phase' | 'playbackRate' | 'sourceDuration' | 'sourceStart'> & { frames: number };
/**
 * Start decoding later when a piece begins deep into its clip (time-split pieces): skip whole
 * extracted frames by moving the seek forward and the phase back by the same frames. The move is
 * exact only when it is a whole number of microseconds (FFmpeg's -ss unit) and of source timestamp
 * units, so rounding the seek cannot shift a source frame across a tick; VFR sources seek accurately
 * and would drop the frame straddling the new seek point, so they keep their original seek.
 */
function seekAhead<T extends Sampling>(segment: T, video: NonNullable<SourceInfo['video']>, fps: number): T {
  const extracted = Math.max(1, Math.ceil(segment.sourceDuration * fps - 1e-6));
  const wanted = Math.min(extracted - 1, Math.floor(Math.max(0, segment.phase) * segment.playbackRate + 1e-9));
  if (video.vfr || !video.timeBase || wanted < 1) return segment;
  const { num: tbNum, den: tbDen } = video.timeBase;
  const step = lcm(fps / gcd(fps, 1e6), fps * tbNum / gcd(fps * tbNum, tbDen));
  const skipped = Math.floor(wanted / step) * step;
  if (skipped < 1) return segment;
  return { ...segment, sourceStart: segment.sourceStart + skipped / fps, sourceDuration: segment.sourceDuration - skipped / fps, phase: segment.phase - skipped / segment.playbackRate };
}

/** HyperFrames' frame sampling, speed mapping and end hold of one clip, ending on its own first visible frame. */
function samplingChain(input: number, segment: Sampling, video: NonNullable<SourceInfo['video']>, fps: number) {
  const { phase, playbackRate: r, frames } = segment;
  // Sample the source on the export frame grid as HyperFrames' extraction does: the frame
  // current at each tick from the media start (CFR), or its CFR resampling of VFR sources.
  const sample = video.vfr ? `fps=${fps}:start_time=0` : `settb=intb/2,setpts=PTS-lte(TB\\,0.001),fps=${fps}:start_time=0:round=up`;
  // It extracts the clip's source duration; lookups past that or the source end hold the
  // final frame (FrameLookupTable holdLastFrame).
  const extracted = Math.max(1, Math.ceil(segment.sourceDuration * fps - 1e-6));
  const lastNeeded = Math.floor(Math.max(0, phase + frames - 1) * r + 1e-9);
  const hold = `trim=end_frame=${extracted},tpad=stop_mode=clone:stop_duration=${num((lastNeeded + 2) / fps)}`;
  // Tick j shows extracted frame floor(max(0, phase + j) * rate). Give each needed frame n
  // its first tick, drop the rest, and let fps repeat frames for slow motion.
  const P = expressionNumber(phase), R = expressionNumber(r);
  const firstTick = (n: string) => `if(eq(${n}\\,0)\\,0\\,max(0\\,ceil((${n}-0.000000001)/${R}-${P})))`;
  const remap = r === 1 && Math.abs(phase) < 1e-9 ? '' : `,setpts=${firstTick('N')},select=eq(floor(max(0\\,${P}+${firstTick('n')})*${R}+0.000000001)\\,n),fps=${fps}`;
  return `[${input}:v:0]${sample},${hold}${remap},trim=end_frame=${frames}`;
}

/**
 * The visual fade of a clip (installVisualFades): the clip's local time, held on its last frame,
 * enters the fade clock at its offset; linear ramps toward black (or transparent, `alpha`) at both
 * ends. Timestamps move to a millisecond-of-a-frame timebase so sub-frame phases survive, and
 * come back as sequential frame numbers.
 */
function fadeChain(fade: PlainFade, phase: number, fps: number, alpha: boolean) {
  const fine = fps * 1000, mode = alpha ? ':alpha=1' : '';
  const stages = [`settb=1/${fine}`, `setpts=max(0\\,min(PTS+${Math.round(phase * 1000)}\\,${Math.round(fade.cap * fps * 1000)}))+${Math.round(fade.offset * fine)}`];
  if (fade.fadeIn > 0) stages.push(`fade=t=in:st=0:d=${num(fade.fadeIn)}${mode}`);
  if (fade.fadeOut > 0) stages.push(`fade=t=out:st=${num(Math.max(0, fade.duration - fade.fadeOut))}:d=${num(fade.fadeOut)}${mode}`);
  stages.push(`settb=1/${fps}`, 'setpts=N');
  return stages.join(',');
}

/** One full-frame clip: HyperFrames' frame sampling, speed mapping, end hold, framing and fade, as one filter chain. */
function clipChain(input: number, segment: Extract<PlainExportPlan['video'][number], { kind: 'clip' }>, video: NonNullable<SourceInfo['video']>, plan: PlainExportPlan, sampling: Sampling = segment) {
  const { width, height } = plan;
  // crop and pad round odd offsets down to the 4:2:0 chroma grid; exact crops keep the luma
  // placement of the browser framing, so odd contain bars pad one extra row/column first.
  const odd = { x: segment.x % 2, y: segment.y % 2 };
  const place = segment.fit === 'cover' ? `crop=${width}:${height}:${segment.x}:${segment.y}:exact=1`
    : odd.x || odd.y ? `pad=${width + 2 * odd.x}:${height + 2 * odd.y}:${segment.x + odd.x}:${segment.y + odd.y}:black,crop=${width}:${height}:${odd.x}:${odd.y}:exact=1`
      : `pad=${width}:${height}:${segment.x}:${segment.y}:black`;
  const fade = segment.fade ? `,${fadeChain(segment.fade, segment.phase, plan.fps, false)}` : '';
  // The fade follows the clip's own time, whatever seek the sampling starts from.
  return `${samplingChain(input, sampling, video, plan.fps)},${colorFilters(video, segment.scaleWidth, segment.scaleHeight)},${place},setsar=1,setpts=PTS-STARTPTS${fade}`;
}

/**
 * The editor's effect canvas for a layer, on its scaled raster: the soft blur (repeated 5x5
 * binomial passes of the given total sigma, sampling clamped to the source edge) and then the
 * grade's exposure, RGB times 2^stops on the display-referred values, clamped.
 */
function lookFilters(layer: PlainLayer, rgb = false) {
  if (!(layer.blur > 0) && !layer.exposure) return rgb ? ',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p' : '';
  const stages = rgb ? [] : ['scale=in_color_matrix=bt709:in_range=tv,format=gbrp'];
  if (layer.blur > 0) {
    // Smeared borders stand in for the shader's clamp-to-edge sampling.
    const pad = Math.ceil(layer.blur * 3) + 2;
    stages.push(`pad=${layer.scaleWidth + 2 * pad}:${layer.scaleHeight + 2 * pad}:${pad}:${pad}`, `fillborders=left=${pad}:right=${pad}:top=${pad}:bottom=${pad}:mode=smear`, `gblur=sigma=${num(layer.blur)}:steps=4`, `crop=${layer.scaleWidth}:${layer.scaleHeight}:${pad}:${pad}`);
  }
  if (layer.exposure) { const gain = num(2 ** layer.exposure); stages.push(`colorchannelmixer=rr=${gain}:gg=${gain}:bb=${gain}`); }
  stages.push('scale=out_color_matrix=bt709:out_range=tv,format=yuv420p');
  return `,${stages.join(',')}`;
}

/** The frames of a layer (counted from its first visible frame) on which a region shows; undefined when it never does. */
function regionFrames(region: PlainRegion, layer: PlainLayer, fps: number) {
  // Frame n shows clip-local time (phase + n) / fps; the browser's range is half-open with the same tolerance.
  const first = region.start === undefined ? 0 : Math.max(0, Math.ceil(region.start * fps - layer.phase - 1e-6 * fps - 1e-9));
  const end = region.end === undefined ? layer.frames : Math.min(layer.frames, Math.ceil(region.end * fps - layer.phase - 1e-6 * fps - 1e-9));
  return end > first ? { first, end } : undefined;
}

/**
 * The browser's region passes on a layer's scaled raster, in display RGB: each region in turn is cut out, blurred
 * (a Gaussian over a margin wide enough to reach past its edge, borders smeared like the shader's clamp)
 * or averaged into its blocks and scaled back without filtering, then laid back over the raster on the
 * frames it shows. Returns graph lines from `input` to `[output]`, which stays gbrp.
 */
function regionGraph(input: string, layer: PlainLayer, fps: number, output: string): string[] {
  const regions = (layer.regions ?? []).flatMap(region => { const frames = regionFrames(region, layer, fps); return frames ? [{ region, frames }] : []; });
  const lines: string[] = [];
  let current = `${output}r0`;
  lines.push(`${input}scale=in_color_matrix=bt709:in_range=tv,format=gbrp[${regions.length ? current : output}]`);
  // Each region is cut from the picture with the earlier ones already drawn, and laid over it: the later one wins where they overlap.
  regions.forEach(({ region, frames }, index) => {
    const { x, y, width, height } = region;
    let cut: string;
    if (region.mode === 'pixelate') cut = `crop=${width}:${height}:${x}:${y}:exact=1,scale=${region.columns}:${region.rows}:flags=area,scale=${width}:${height}:flags=neighbor`;
    else {
      const margin = Math.ceil(region.sigma * 3) + 2;
      const left = Math.max(0, x - margin), top = Math.max(0, y - margin), right = Math.min(layer.scaleWidth, x + width + margin), bottom = Math.min(layer.scaleHeight, y + height + margin);
      cut = `crop=${right - left}:${bottom - top}:${left}:${top}:exact=1,pad=${right - left + 2 * margin}:${bottom - top + 2 * margin}:${margin}:${margin},fillborders=left=${margin}:right=${margin}:top=${margin}:bottom=${margin}:mode=smear,gblur=sigma=${num(region.sigma)}:steps=4,crop=${width}:${height}:${x - left + margin}:${y - top + margin}:exact=1`;
    }
    const enable = frames.first === 0 && frames.end >= layer.frames ? '' : `:enable=gte(n\\,${frames.first})*lt(n\\,${frames.end})`;
    const next = index === regions.length - 1 ? output : `${output}r${index + 1}`;
    lines.push(`[${current}]split=2[${output}b${index}][${output}c${index}]`, `[${output}c${index}]${cut}[${output}q${index}]`, `[${output}b${index}][${output}q${index}]overlay=x=${x}:y=${y}:format=gbrp${enable}[${next}]`);
    current = next;
  });
  return lines;
}

/**
 * A stack segment: every layer over black in paint order. Layers that show the same source
 * frames decode once and split; layers that also share their raster and look (mirror-blur
 * copies) blur once, then flip, turn, fade and place their own copy. A crossfade paints its two
 * shots over copies of the layers beneath them and mixes the two pictures linearly (xfade), as the
 * browser's plus-lighter group of the two shots composites over the rest.
 */
function stackChain(segment: Extract<PlainExportPlan['video'][number], { kind: 'stack' }>, firstInput: number, sources: { video: NonNullable<SourceInfo['video']> }[], plan: PlainExportPlan, label: string) {
  const { fps, width, height } = plan, graph: string[] = [];
  const samplings = [...new Set(segment.layers.map(samplingKey))];
  const looks = new Map<string, PlainLayer[]>();
  for (const layer of segment.layers) {
    const key = JSON.stringify([samplingKey(layer), layer.scaleWidth, layer.scaleHeight, layer.crop, layer.blur, layer.exposure, layer.regions ?? null]);
    looks.set(key, [...looks.get(key) ?? [], layer]);
  }
  const split = (source: string, count: number, prefix: string) => count === 1 ? [source] : (graph.push(`${source}split=${count}${Array.from({ length: count }, (_, index) => `[${prefix}_${index}]`).join('')}`), Array.from({ length: count }, (_, index) => `[${prefix}_${index}]`));
  const sampled = new Map(samplings.map((key, index) => {
    const layer = segment.layers.find(item => samplingKey(item) === key)!;
    const uses = [...looks.values()].filter(group => samplingKey(group[0]) === key).length;
    graph.push(`${samplingChain(firstInput + index, seekAhead(layer, sources[index].video, fps), sources[index].video, fps)}[${label}s${index}]`);
    return [key, split(`[${label}s${index}]`, uses, `${label}s${index}`)];
  }));
  const placed = new Map<PlainLayer, string>();
  for (const [index, group] of [...looks.values()].entries()) {
    const [layer] = group, { crop } = layer;
    const decoded = `${sampled.get(samplingKey(layer))!.shift()}${colorFilters(sources[samplings.indexOf(samplingKey(layer))].video, layer.scaleWidth, layer.scaleHeight)}`;
    if (layer.regions?.length) {
      graph.push(...regionGraph(`${decoded},`, layer, fps, `${label}g${index}`));
      graph.push(`[${label}g${index}]${lookFilters(layer, true).slice(1)},crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1[${label}l${index}]`);
    } else graph.push(`${decoded}${lookFilters(layer)},crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1[${label}l${index}]`);
    for (const [copy, output] of split(`[${label}l${index}]`, group.length, `${label}l${index}`).entries()) placed.set(group[copy], output);
  }
  graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${num((segment.frames + 1) / fps)},format=yuv420p,trim=end_frame=${segment.frames},setsar=1,setpts=PTS-STARTPTS[${label}b0]`);
  let base = `${label}b0`, painted = 0;
  const paint = (layer: PlainLayer, index: number, over: string, out: string) => {
    const flip = [layer.flip.horizontal ? 'hflip' : '', layer.flip.vertical ? 'vflip' : ''].filter(Boolean).map(filter => `${filter},`).join('');
    const turn = layer.rotate === 90 ? 'transpose=1,' : layer.rotate === 270 ? 'transpose=2,' : layer.rotate === 180 ? 'hflip,vflip,' : '';
    const fade = layer.fade ? `format=yuva420p,${fadeChain(layer.fade, layer.phase, fps, true)},` : '';
    graph.push(`${placed.get(layer)}${flip}${turn}${fade}setsar=1,setpts=PTS-STARTPTS+${num(layer.offset / fps)}/TB[${label}p${index}]`);
    graph.push(`[${over}][${label}p${index}]overlay=x=${layer.x}:y=${layer.y}:eof_action=pass:repeatlast=0:format=yuv420[${out}]`);
  };
  const next = () => `${label}b${++painted}`;
  for (const [index, layer] of segment.layers.entries()) {
    const transition = segment.transition;
    if (!transition || (index !== transition.from && index !== transition.to)) { const out = next(); paint(layer, index, base, out); base = out; continue; }
    if (index === transition.to) continue;
    if (transition.to !== transition.from + 1) throw new Error('Fast export crossfade layers must be adjacent.');
    // The incoming shot's pts sit on the frame grid; a finer timebase lets the mix start a fraction of a frame early.
    const fine = fps * 1000, outgoing = segment.layers[transition.from], incoming = segment.layers[transition.to];
    graph.push(`[${base}]split=2[${label}xa][${label}xb]`);
    paint(outgoing, index, `${label}xa`, `${label}xa1`); paint(incoming, index + 1, `${label}xb`, `${label}xb1`);
    const out = next();
    graph.push(`[${label}xa1]settb=1/${fine}[${label}xa2]`, `[${label}xb1]settb=1/${fine}[${label}xb2]`, `[${label}xa2][${label}xb2]xfade=transition=fade:duration=${num(transition.duration)}:offset=${num(-transition.phase / fps)},settb=1/${fps},setpts=N[${out}]`);
    base = out;
  }
  graph.push(`[${base}]trim=end_frame=${segment.frames},setsar=1,setpts=PTS-STARTPTS[${label}]`);
  return graph;
}

/**
 * The native producer's per-track audio chain and mix, as filter graph lines reading inputs
 * firstInput..n. Labels the mix [audio]; no line is written without sound.
 */
async function audioMix(plan: PlainAudioPlan, probe: (assetId: string) => Promise<SourceInfo>, pathOf: (assetId: string) => string, audioSourceOffsets: Record<string, number>, firstInput: number, threads: number) {
  const audioInputs: string[][] = [], graph: string[] = [], tracks: string[] = [];
  for (const track of plan.audio) {
    const source = await probe(track.assetId);
    if (source.audioStreams === 0) continue;
    if (source.audioStreams !== 1) throw new Error('Fast export needs at most one audio stream per source.');
    const offset = track.kind === 'audio' ? audioSourceOffsets[track.assetId] ?? 0 : 0;
    // The native producer's prepared track: accurate seek, stereo PCM at 48 kHz with atempo,
    // gain baked into 16-bit samples, fades, delay.
    const input = audioInputs.length + firstInput;
    audioInputs.push(['-ss', ffmpegTime(Math.max(0, track.sourceStart - offset)), '-t', ffmpegTime(track.duration * track.playbackRate), '-vn', '-sn', '-dn', '-threads', String(threads), '-i', pathOf(track.assetId)]);
    const stereo = source.audioChannels === 1 ? 'pan=stereo|FL=FL+FC|FR=FR+FC' : 'aformat=channel_layouts=stereo';
    const stages: number[] = [];
    let remaining = track.playbackRate;
    while (remaining < 0.5 - 1e-9) { stages.push(0.5); remaining /= 0.5; }
    while (remaining > 2 + 1e-9) { stages.push(2); remaining /= 2; }
    if (Math.abs(remaining - 1) >= 1e-9) stages.push(remaining);
    const fadeIn = track.fadeIn > 0 ? `,afade=t=in:st=0:d=${num(track.fadeIn)}` : '';
    const fadeOut = track.fadeOut > 0 ? `,afade=t=out:st=${num(Math.max(0, track.duration - track.fadeOut))}:d=${num(track.fadeOut)}` : '';
    const delay = Math.round(track.start * 1000);
    graph.push(`[${input}:a:0]${stereo},${stages.map(stage => `atempo=${num(stage)},`).join('')}aresample=48000,aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo,atrim=0:${num(track.duration)},volume=${num(track.volume)}${fadeIn}${fadeOut},adelay=${delay}|${delay},apad,asetpts=N/SR/TB,atrim=0:${num(plan.duration)}[a${tracks.length}]`);
    tracks.push(`[a${tracks.length}]`);
  }
  // amix normalizes by its input count; the producer restores unity with its master gain.
  const masterGain = Number(process.env.PRODUCER_AUDIO_GAIN ?? 1);
  if (tracks.length) graph.push(`${tracks.join('')}amix=inputs=${tracks.length}:duration=longest:dropout_transition=0[mixed];[mixed]volume=${num((Number.isFinite(masterGain) && masterGain >= 0 ? masterGain : 1) * tracks.length)}[audio]`);
  return { audioInputs, graph, tracks };
}

export type PlainExportResult = { frames: number; elapsedMs: number; segments?: { total: number; reused: number; encodedFrames: number; concurrency: number; threads: number } };
/** Where segments are cached (worker disk, scoped to one backend project) and the identity of each source file. */
export type SegmentCache = { scope?: string; assets: Record<string, string> };
/** Static text and image rasters, made on first use: an export whose segments are all cached opens no browser. */
export type OverlayRasters = () => Promise<string[]>;

/** Prepared export media by asset, each probed once. */
function exportSources(directory: string, assetUrls: Record<string, string>, signal: AbortSignal) {
  const pathOf = (assetId: string) => {
    const url = assetUrls[assetId];
    if (!url?.startsWith('./')) throw new Error('Fast export source media is unavailable.');
    return join(directory, url.slice(2));
  };
  const sources = new Map<string, Promise<SourceInfo>>();
  const probe = (assetId: string) => { if (!sources.has(assetId)) sources.set(assetId, probeSource(pathOf(assetId), signal)); return sources.get(assetId)!; };
  return { pathOf, probe };
}

async function countVideoPackets(path: string, signal: AbortSignal) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets,width,height', '-of', 'json', path], { signal, timeout: 60_000, maxBuffer: 1024 * 1024 });
  return (JSON.parse(stdout) as { streams?: { nb_read_packets?: string; width?: number; height?: number }[] }).streams?.[0];
}

/**
 * Audio-only re-export: an earlier export's video stream, copied bit for bit, with this
 * export's sound mixed exactly as the fast path mixes it. The caller has matched the picture
 * (exportVisualKey); the frame count and canvas are checked again here.
 */
export async function remuxExportAudio(directory: string, output: string, video: string, plan: PlainAudioPlan, size: { width: number; height: number }, assetUrls: Record<string, string>, audioSourceOffsets: Record<string, number>, signal: AbortSignal): Promise<PlainExportResult> {
  const started = performance.now();
  try {
    const picture = await countVideoPackets(video, signal);
    if (Number(picture?.nb_read_packets) !== plan.frames || picture?.width !== size.width || picture?.height !== size.height) throw new Error(`The earlier export has ${picture?.nb_read_packets ?? 0} of ${plan.frames} frames at ${picture?.width}x${picture?.height}.`);
    const { pathOf, probe } = exportSources(directory, assetUrls, signal);
    await Promise.all(plan.audio.map(track => probe(track.assetId)));
    const { audioInputs, graph, tracks } = await audioMix(plan, probe, pathOf, audioSourceOffsets, 1, 1);
    await run('ffmpeg', [
      '-hide_banner', '-v', 'error', '-nostdin', '-i', video, ...audioInputs.flat(),
      ...graph.length ? ['-filter_complex', graph.join(';')] : [],
      '-map', '0:v:0', ...tracks.length ? ['-map', '[audio]', '-c:a', 'aac', '-b:a', '192k'] : [],
      '-c:v', 'copy', '-map_metadata', '-1', '-map_chapters', '-1', '-video_track_timescale', '90000',
      '-threads', String(renderResources().encodeThreads), '-movflags', '+faststart', '-y', output,
    ], { signal, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    const stream = await countVideoPackets(output, signal);
    if (Number(stream?.nb_read_packets) !== plan.frames) throw new Error(`The remuxed export has ${stream?.nb_read_packets ?? 0} of ${plan.frames} frames.`);
    return { frames: plan.frames, elapsedMs: performance.now() - started };
  } catch (error) {
    if (signal.aborted) throw new Error('The render was cancelled.');
    throw error;
  }
}


/**
 * Render an eligible timeline without a browser. Every footage segment (a cut, stack, crossfade or gap)
 * is encoded alone with the export's x264 settings, starting on its own keyframe, with HyperFrames-
 * identical frame sampling and framing and its static text and images laid over it. Segments whose
 * fingerprint (clips, source ranges, layout, effects, fades, text and encoder settings) is in the
 * worker's cache are reused; the rest are encoded, several at once, while the sound mixes alongside.
 * The segments are joined with stream copy and muxed with the mixed sound, so an audio-only change
 * encodes no video at all.
 */
export async function renderPlainExport(directory: string, output: string, plan: PlainExportPlan, assetUrls: Record<string, string>, audioSourceOffsets: Record<string, number>, quality: Quality, onProgress: (render: { progress: number }) => void, signal: AbortSignal, texts: OverlayRasters, cache: SegmentCache): Promise<PlainExportResult> {
  signal.throwIfAborted();
  try {
    return await render(directory, output, plan, assetUrls, audioSourceOffsets, quality, onProgress, signal, texts, cache);
  } catch (error) {
    // Probes, children and the output check all report cancellation the same way.
    if (signal.aborted) throw new Error('The render was cancelled.');
    throw error;
  }
}

function encoderArgs(quality: Quality, threads: number) {
  const x264 = RENDER_X264[quality];
  const params = x264.preset === 'ultrafast' ? 'aq-mode=3' : 'aq-mode=3:aq-strength=0.8:deblock=1,1';
  // HyperFrames' buildEncoderArgs for SDR H.264 MP4, with Revline's preset and CRF.
  return ['-c:v', 'libx264', '-preset', x264.preset, '-crf', String(x264.crf), '-bf', '0',
    '-x264-params', `${params}:colorprim=bt709:transfer=bt709:colormatrix=bt709`,
    '-colorspace:v', 'bt709', '-color_primaries:v', 'bt709', '-color_trc:v', 'bt709', '-color_range', 'tv',
    '-video_track_timescale', '90000', '-pix_fmt', 'yuv420p', '-threads', String(threads)];
}

/** The segment's part of an overlay's opacity ramp, when it has one. */
type SegmentOverlay = { textIndex: number; look: string; assetId?: string; first: number; end: number; alpha?: number[] };

async function render(directory: string, output: string, plan: PlainExportPlan, assetUrls: Record<string, string>, audioSourceOffsets: Record<string, number>, quality: Quality, onProgress: (render: { progress: number }) => void, signal: AbortSignal, texts: OverlayRasters, cache: SegmentCache): Promise<PlainExportResult> {
  const started = performance.now();
  const { pathOf, probe } = exportSources(directory, assetUrls, signal);
  await Promise.all([...plan.video.flatMap(segment => segment.kind === 'clip' ? [segment.assetId] : segment.kind === 'stack' ? segment.layers.map(layer => layer.assetId) : []), ...plan.audio.map(track => track.assetId)].map(probe));
  const { fps, width, height } = plan;
  const resources = plainExportResources();
  let rasters: Promise<string[]> | undefined;
  const raster = (index: number) => (rasters ??= texts()).then(images => {
    if (images.length !== plan.overlays.length) throw new Error('Fast export overlays were not rasterized.');
    return images[index];
  });
  // Each segment's frames on the output timeline, the text and images over it, and its fingerprint.
  let cursor = 0;
  const segments = plan.video.map((segment, index) => {
    const first = cursor;
    cursor += segment.frames;
    const overlays = plan.overlays.flatMap((overlay, textIndex): SegmentOverlay[] => {
      if (!(overlay.first < first + segment.frames && overlay.end > first)) return [];
      const from = Math.max(0, overlay.first - first), end = Math.min(segment.frames, overlay.end - first);
      const alpha = overlay.alpha?.slice(from + first - overlay.first, end + first - overlay.first);
      return [{ textIndex, look: overlay.look, assetId: overlay.assetId, first: from, end, ...alpha ? { alpha } : {} }];
    });
    const assetIds = segment.kind === 'clip' ? [segment.assetId] : segment.kind === 'stack' ? segment.layers.map(layer => layer.assetId) : [];
    const overlayAssets = overlays.flatMap(overlay => overlay.assetId ? [overlay.assetId] : []);
    const key = createHash('sha256').update(JSON.stringify([SEGMENT_FORMAT, width, height, fps, encoderArgs(quality, 0), pixelsOf(segment), assetIds.map(id => cache.assets[id] ?? null), overlays.map(({ look, assetId, first: from, end, alpha }) => [look, assetId ? cache.assets[assetId] ?? null : null, from, end, alpha ?? null])])).digest('hex');
    return { index, segment, overlays, key, path: join(directory, `segment-${index}.mp4`), cacheable: !!cache.scope && [...assetIds, ...overlayAssets].every(id => cache.assets[id]) };
  });
  // The sound mixes while the segments encode; the final mux copies both. A failed segment stops the mix too.
  const mixing = new AbortController(), mixSignal = AbortSignal.any([signal, mixing.signal]);
  const audio = (async () => {
    const { audioInputs, graph, tracks } = await audioMix(plan, probe, pathOf, audioSourceOffsets, 0, resources.decodeThreads);
    if (!tracks.length) return undefined;
    const path = join(directory, 'audio.m4a');
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', ...audioInputs.flat(), '-filter_complex', graph.join(';'), '-map', '[audio]', '-c:a', 'aac', '-b:a', '192k', '-threads', String(resources.filterThreads), '-y', path], { signal: mixSignal, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    return path;
  })();
  audio.catch(() => {});
  let done = 0, reused = 0, encodedFrames = 0;
  await forEachLimited(segments, resources.concurrency, async (item, stop) => {
    const segmentSignal = AbortSignal.any([signal, stop]);
    const encode = async () => {
      await encodeSegment(item, plan, pathOf, probe, raster, quality, resources, segmentSignal);
      encodedFrames += item.segment.frames;
    };
    if (item.cacheable && await reuseMediaFile({ identity: cache.scope, variant: `export-segment:${item.key}`, target: item.path, signal: segmentSignal, pool: 'export-segments' }, encode)) reused++;
    else if (!item.cacheable) await encode();
    const frames = await countVideoPackets(item.path, segmentSignal);
    if (Number(frames?.nb_read_packets) !== item.segment.frames || frames?.width !== width || frames?.height !== height) throw new Error(`Fast export segment ${item.index} has ${frames?.nb_read_packets ?? 0} of ${item.segment.frames} frames.`);
    done += item.segment.frames;
    // Percent, like the HyperFrames worker it stands in for; the final mux takes the last few.
    onProgress({ progress: Math.min(95, done / plan.frames * 95) });
  }).catch(error => { mixing.abort(); throw error; });
  const sound = await audio;
  // Join the encoded segments without re-encoding them, then mux in this export's sound.
  const list = join(directory, 'segments.txt');
  await writeFile(list, segments.map(item => `file '${item.path.replace(/'/g, "'\\''")}'\n`).join(''));
  await run('ffmpeg', [
    '-hide_banner', '-v', 'error', '-nostdin', '-f', 'concat', '-safe', '0', '-i', list, ...sound ? ['-i', sound] : [],
    '-map', '0:v:0', ...sound ? ['-map', '1:a:0', '-c:a', 'copy'] : [],
    '-c:v', 'copy', '-map_metadata', '-1', '-map_chapters', '-1', '-video_track_timescale', '90000',
    // No -avoid_negative_ts: it would move AAC priming into the timeline instead of the edit list.
    '-threads', String(resources.filterThreads), '-movflags', '+faststart', '-y', output,
  ], { signal, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  // Never hand back a short or truncated file; the caller falls back to the browser renderer.
  const stream = await countVideoPackets(output, signal);
  if (Number(stream?.nb_read_packets) !== plan.frames || stream?.width !== width || stream?.height !== height) throw new Error(`Fast export produced ${stream?.nb_read_packets ?? 0} of ${plan.frames} frames at ${stream?.width}x${stream?.height}.`);
  onProgress({ progress: 100 });
  return { frames: plan.frames, elapsedMs: performance.now() - started, segments: { total: segments.length, reused, encodedFrames, concurrency: resources.concurrency, threads: resources.encodeThreads } };
}

/** A segment without clip ids: a recut that recreates the same picture still hits the cache. */
function pixelsOf(segment: PlainExportPlan['video'][number]) {
  if (segment.kind === 'gap') return segment;
  if (segment.kind === 'clip') { const { clipId: _clipId, ...rest } = segment; return rest; }
  return { ...segment, layers: segment.layers.map(({ clipId: _clipId, ...rest }) => rest) };
}

/** One footage segment as its own H.264 file: black, one framed clip, or a stack, with its static text and images over it. */
async function encodeSegment(item: { index: number; segment: PlainExportPlan['video'][number]; overlays: SegmentOverlay[]; path: string }, plan: PlainExportPlan, pathOf: (assetId: string) => string, probe: (assetId: string) => Promise<SourceInfo>, raster: (index: number) => Promise<string>, quality: Quality, resources: Resources, signal: AbortSignal) {
  const { segment } = item, { fps, width, height } = plan;
  const inputs: string[][] = [], graph: string[] = [];
  const decoder = (source: SourceInfo, sampling: { sourceStart: number }, assetId: string) => {
    if (!source.video || source.videoStreams !== 1) throw new Error('Fast export needs exactly one video stream per source.');
    if (!(sampling.sourceStart < source.duration)) throw new Error('Video media start is outside the source duration.');
    // No input duration limit: a non-accurate seek starts at the previous keyframe with negative
    // timestamps, as in HyperFrames. Decoding stops once the clip's trim ends its chain.
    inputs.push([...source.video.vfr ? [] : ['-noaccurate_seek'], '-ss', ffmpegTime(sampling.sourceStart), '-an', '-sn', '-dn', '-threads', String(resources.decodeThreads), '-i', pathOf(assetId)]);
  };
  if (segment.kind === 'gap') {
    graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${num((segment.frames + 1) / fps)},format=yuv420p,trim=end_frame=${segment.frames},setsar=1,setpts=PTS-STARTPTS[v]`);
  } else if (segment.kind === 'stack') {
    const keys = [...new Set(segment.layers.map(samplingKey))], sampled: { video: NonNullable<SourceInfo['video']> }[] = [];
    for (const key of keys) {
      const layer = segment.layers.find(entry => samplingKey(entry) === key)!, source = await probe(layer.assetId);
      if (!source.video) throw new Error('Fast export needs exactly one video stream per source.');
      sampled.push({ video: source.video });
      decoder(source, seekAhead(layer, source.video, fps), layer.assetId);
    }
    graph.push(...stackChain(segment, 0, sampled, plan, 'v'));
  } else {
    const source = await probe(segment.assetId);
    if (!source.video) throw new Error('Fast export needs exactly one video stream per source.');
    const sampling = seekAhead(segment, source.video, fps);
    graph.push(`${clipChain(0, segment, source.video, plan, sampling)}[v]`);
    decoder(source, sampling, segment.assetId);
  }
  // Static text and images, rasterized by the browser renderer, over the footage in paint order.
  let picture = 'v';
  for (const [index, overlay] of item.overlays.entries()) {
    const visible = `enable=between(n\\,${overlay.first}\\,${overlay.end - 1})`;
    if (overlay.alpha) {
      // The raster repeats from memory on the frame grid while per-frame commands scale its alpha.
      inputs.push(['-framerate', String(fps), '-i', await raster(overlay.textIndex)]);
      const mixer = `colorchannelmixer@o${index}`, commands: string[] = [];
      let current = overlay.alpha[0];
      for (const [frame, alpha] of overlay.alpha.entries()) if (alpha !== current) { current = alpha; commands.push(`${num((overlay.first + frame - .5) / fps)} ${mixer} aa ${num(alpha)}`); }
      graph.push(`[${inputs.length - 1}:v]loop=loop=-1:size=1:start=0,setpts=N/${fps}/TB,trim=end_frame=${segment.frames},format=rgba,${commands.length ? `sendcmd=c='${commands.join(';')}',` : ''}${mixer}=aa=${num(overlay.alpha[0])}[o${index}]`);
      graph.push(`[${picture}][o${index}]overlay=x=0:y=0:eof_action=repeat:format=yuv420:${visible}[t${index}]`);
    } else {
      inputs.push(['-i', await raster(overlay.textIndex)]);
      graph.push(`[${picture}][${inputs.length - 1}:v]overlay=x=0:y=0:eof_action=repeat:format=yuv420:${visible}[t${index}]`);
    }
    picture = `t${index}`;
  }
  graph.push(`[${picture}]format=yuv420p,setsar=1[picture]`);
  await run('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-filter_complex_threads', String(resources.filterThreads), ...inputs.flat(), '-filter_complex', graph.join(';'), '-map', '[picture]', '-an', '-map_metadata', '-1', '-map_chapters', '-1', ...encoderArgs(quality, resources.encodeThreads), '-r', String(fps), '-frames:v', String(segment.frames), '-y', item.path], { signal, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
}
