import { ffmpegTime } from '../ffmpeg-time.mjs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { samplingKey, type PlainAudioPlan, type PlainExportPlan, type PlainLayer } from '../editor/plain-export';
import { RENDER_X264, renderResources } from '../render-resources.mjs';
import { reuseMediaFile } from './media-file-cache';
import { forEachLimited } from './run-limited';

const run = promisify(execFile);
type Quality = keyof typeof RENDER_X264;
type SourceInfo = {
  duration: number;
  video?: { codec: string; pixFmt: string; height: number; matrix?: string; range?: string; transfer?: string; primaries?: string; vfr: boolean; alphaTagged: boolean };
  videoStreams: number; audioStreams: number; audioChannels?: number;
};
type ProbeStream = { codec_type?: string; codec_name?: string; pix_fmt?: string; height?: number; color_space?: string; color_range?: string; color_transfer?: string; color_primaries?: string; r_frame_rate?: string; avg_frame_rate?: string; channels?: number; disposition?: { attached_pic?: number }; tags?: { alpha_mode?: string } };

// Each footage segment is its own short encode, cached on the worker by what it shows, so a
// re-export encodes only changed segments and stream-copies the rest. A segment process opens
// at most PLAIN_EXPORT_MAX_STACK_SOURCES decoders (about 25 MiB each at 1080p); two run at once.
const SEGMENT_CONCURRENCY = 2;
// Bump when a segment's pixels would change for the same plan (filters, encoder settings).
export const SEGMENT_FORMAT = 1;

const known = (value?: string) => value && value !== 'unknown' && value !== 'reserved' ? value : undefined;
const rate = (value?: string) => { const [n, d] = (value ?? '').split('/').map(Number); return n > 0 && d > 0 ? n / d : 0; };
// Fixed notation keeps FFmpeg expressions free of exponents and locale effects.
// Filter values keep sub-microsecond precision; time options go through ffmpegTime.
const num = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(12).replace(/\.?0+$/, '');
const expressionNumber = (value: number) => `(${num(value)})`;

async function probeSource(path: string, signal: AbortSignal): Promise<SourceInfo> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,pix_fmt,height,color_space,color_range,color_transfer,color_primaries,r_frame_rate,avg_frame_rate,channels:stream_disposition=attached_pic:stream_tags=alpha_mode', '-of', 'json', path], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
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

type Sampling = Pick<Extract<PlainExportPlan['video'][number], { kind: 'clip' }>, 'phase' | 'playbackRate' | 'sourceDuration'> & { frames: number };
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

/** One full-frame clip: HyperFrames' frame sampling, speed mapping, end hold and framing, as one filter chain. */
function clipChain(input: number, segment: Extract<PlainExportPlan['video'][number], { kind: 'clip' }>, video: NonNullable<SourceInfo['video']>, plan: PlainExportPlan) {
  const { width, height } = plan;
  // crop and pad round odd offsets down to the 4:2:0 chroma grid; exact crops keep the luma
  // placement of the browser framing, so odd contain bars pad one extra row/column first.
  const odd = { x: segment.x % 2, y: segment.y % 2 };
  const place = segment.fit === 'cover' ? `crop=${width}:${height}:${segment.x}:${segment.y}:exact=1`
    : odd.x || odd.y ? `pad=${width + 2 * odd.x}:${height + 2 * odd.y}:${segment.x + odd.x}:${segment.y + odd.y}:black,crop=${width}:${height}:${odd.x}:${odd.y}:exact=1`
      : `pad=${width}:${height}:${segment.x}:${segment.y}:black`;
  return `${samplingChain(input, segment, video, plan.fps)},${colorFilters(video, segment.scaleWidth, segment.scaleHeight)},${place},setsar=1,setpts=PTS-STARTPTS`;
}

/**
 * The editor's effect canvas for a layer, on its scaled raster: the soft blur (repeated 5x5
 * binomial passes of the given total sigma, sampling clamped to the source edge) and then the
 * grade's exposure, RGB times 2^stops on the display-referred values, clamped.
 */
function lookFilters(layer: PlainLayer) {
  if (!(layer.blur > 0) && !layer.exposure) return '';
  const stages = ['scale=in_color_matrix=bt709:in_range=tv,format=gbrp'];
  if (layer.blur > 0) {
    // Smeared borders stand in for the shader's clamp-to-edge sampling.
    const pad = Math.ceil(layer.blur * 3) + 2;
    stages.push(`pad=${layer.scaleWidth + 2 * pad}:${layer.scaleHeight + 2 * pad}:${pad}:${pad}`, `fillborders=left=${pad}:right=${pad}:top=${pad}:bottom=${pad}:mode=smear`, `gblur=sigma=${num(layer.blur)}:steps=4`, `crop=${layer.scaleWidth}:${layer.scaleHeight}:${pad}:${pad}`);
  }
  if (layer.exposure) { const gain = num(2 ** layer.exposure); stages.push(`colorchannelmixer=rr=${gain}:gg=${gain}:bb=${gain}`); }
  stages.push('scale=out_color_matrix=bt709:out_range=tv,format=yuv420p');
  return `,${stages.join(',')}`;
}

/**
 * A stack segment: every layer over black in paint order. Layers that show the same source
 * frames decode once and split; layers that also share their raster and look (mirror-blur
 * copies) blur once, then flip and place their own copy.
 */
function stackChain(segment: Extract<PlainExportPlan['video'][number], { kind: 'stack' }>, firstInput: number, sources: { video: NonNullable<SourceInfo['video']> }[], plan: PlainExportPlan, label: string) {
  const { fps, width, height } = plan, graph: string[] = [];
  const samplings = [...new Set(segment.layers.map(samplingKey))];
  const looks = new Map<string, PlainLayer[]>();
  for (const layer of segment.layers) {
    const key = JSON.stringify([samplingKey(layer), layer.scaleWidth, layer.scaleHeight, layer.crop, layer.blur, layer.exposure]);
    looks.set(key, [...looks.get(key) ?? [], layer]);
  }
  const split = (source: string, count: number, prefix: string) => count === 1 ? [source] : (graph.push(`${source}split=${count}${Array.from({ length: count }, (_, index) => `[${prefix}_${index}]`).join('')}`), Array.from({ length: count }, (_, index) => `[${prefix}_${index}]`));
  const sampled = new Map(samplings.map((key, index) => {
    const layer = segment.layers.find(item => samplingKey(item) === key)!;
    const uses = [...looks.values()].filter(group => samplingKey(group[0]) === key).length;
    graph.push(`${samplingChain(firstInput + index, layer, sources[index].video, fps)}[${label}s${index}]`);
    return [key, split(`[${label}s${index}]`, uses, `${label}s${index}`)];
  }));
  const placed = new Map<PlainLayer, string>();
  for (const [index, group] of [...looks.values()].entries()) {
    const [layer] = group, { crop } = layer;
    graph.push(`${sampled.get(samplingKey(layer))!.shift()}${colorFilters(sources[samplings.indexOf(samplingKey(layer))].video, layer.scaleWidth, layer.scaleHeight)}${lookFilters(layer)},crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1[${label}l${index}]`);
    for (const [copy, output] of split(`[${label}l${index}]`, group.length, `${label}l${index}`).entries()) placed.set(group[copy], output);
  }
  graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${num((segment.frames + 1) / fps)},format=yuv420p,trim=end_frame=${segment.frames},setsar=1,setpts=PTS-STARTPTS[${label}b0]`);
  for (const [index, layer] of segment.layers.entries()) {
    const flip = [layer.flip.horizontal ? 'hflip' : '', layer.flip.vertical ? 'vflip' : ''].filter(Boolean).map(filter => `${filter},`).join('');
    graph.push(`${placed.get(layer)}${flip}setsar=1,setpts=PTS-STARTPTS+${num(layer.offset / fps)}/TB[${label}p${index}]`);
    graph.push(`[${label}b${index}][${label}p${index}]overlay=x=${layer.x}:y=${layer.y}:eof_action=pass:repeatlast=0:format=yuv420[${label}b${index + 1}]`);
  }
  graph.push(`[${label}b${segment.layers.length}]trim=end_frame=${segment.frames},setsar=1,setpts=PTS-STARTPTS[${label}]`);
  return graph;
}

/**
 * The native producer's per-track audio chain and mix, as filter graph lines reading inputs
 * 1..n (input 0 is the picture). Labels the mix [audio]; no line is written without sound.
 */
async function audioMix(plan: PlainAudioPlan, probe: (assetId: string) => Promise<SourceInfo>, pathOf: (assetId: string) => string, audioSourceOffsets: Record<string, number>) {
  const audioInputs: string[][] = [], graph: string[] = [], tracks: string[] = [];
  for (const track of plan.audio) {
    const source = await probe(track.assetId);
    if (source.audioStreams === 0) continue;
    if (source.audioStreams !== 1) throw new Error('Fast export needs at most one audio stream per source.');
    const offset = track.kind === 'audio' ? audioSourceOffsets[track.assetId] ?? 0 : 0;
    // Input 0 is the picture. Then the native producer's prepared track: accurate
    // seek, stereo PCM at 48 kHz with atempo, gain baked into 16-bit samples, fades, delay.
    const input = audioInputs.length + 1;
    audioInputs.push(['-ss', ffmpegTime(Math.max(0, track.sourceStart - offset)), '-t', ffmpegTime(track.duration * track.playbackRate), '-vn', '-sn', '-dn', '-threads', '1', '-i', pathOf(track.assetId)]);
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

export type PlainExportResult = { frames: number; elapsedMs: number; segments?: { total: number; reused: number; encodedFrames: number } };
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
    const { audioInputs, graph, tracks } = await audioMix(plan, probe, pathOf, audioSourceOffsets);
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
 * Render an eligible timeline without a browser. Every footage segment (a cut, stack or gap)
 * is encoded alone with the export's x264 settings, starting on its own keyframe, with HyperFrames-
 * identical frame sampling and framing and its static text and images laid over it. Segments whose
 * fingerprint (clips, source ranges, layout, effects, text and encoder settings) is in the
 * worker's cache are reused; the rest are encoded. The segments are joined with stream copy and
 * muxed with the native producer's audio mix, so an audio-only change encodes no video at all.
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

async function render(directory: string, output: string, plan: PlainExportPlan, assetUrls: Record<string, string>, audioSourceOffsets: Record<string, number>, quality: Quality, onProgress: (render: { progress: number }) => void, signal: AbortSignal, texts: OverlayRasters, cache: SegmentCache): Promise<PlainExportResult> {
  const started = performance.now();
  const { pathOf, probe } = exportSources(directory, assetUrls, signal);
  await Promise.all([...plan.video.flatMap(segment => segment.kind === 'clip' ? [segment.assetId] : segment.kind === 'stack' ? segment.layers.map(layer => layer.assetId) : []), ...plan.audio.map(track => track.assetId)].map(probe));
  const { fps, width, height } = plan;
  const threads = Math.max(1, Math.floor(renderResources().encodeThreads / SEGMENT_CONCURRENCY));
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
    const overlays = plan.overlays.flatMap((overlay, textIndex) => overlay.first < first + segment.frames && overlay.end > first ? [{ textIndex, look: overlay.look, assetId: overlay.assetId, first: Math.max(0, overlay.first - first), end: Math.min(segment.frames, overlay.end - first) }] : []);
    const assetIds = segment.kind === 'clip' ? [segment.assetId] : segment.kind === 'stack' ? segment.layers.map(layer => layer.assetId) : [];
    const overlayAssets = overlays.flatMap(overlay => overlay.assetId ? [overlay.assetId] : []);
    const key = createHash('sha256').update(JSON.stringify([SEGMENT_FORMAT, width, height, fps, encoderArgs(quality, 0), pixelsOf(segment), assetIds.map(id => cache.assets[id] ?? null), overlays.map(({ look, assetId, first: from, end }) => [look, assetId ? cache.assets[assetId] ?? null : null, from, end])])).digest('hex');
    return { index, segment, overlays, key, path: join(directory, `segment-${index}.mp4`), cacheable: !!cache.scope && [...assetIds, ...overlayAssets].every(id => cache.assets[id]) };
  });
  let done = 0, reused = 0, encodedFrames = 0;
  await forEachLimited(segments, SEGMENT_CONCURRENCY, async (item, stop) => {
    const segmentSignal = AbortSignal.any([signal, stop]);
    const encode = async () => {
      await encodeSegment(item, plan, pathOf, probe, raster, quality, threads, segmentSignal);
      encodedFrames += item.segment.frames;
    };
    if (item.cacheable && await reuseMediaFile({ identity: cache.scope, variant: `export-segment:${item.key}`, target: item.path, signal: segmentSignal, pool: 'export-segments' }, encode)) reused++;
    else if (!item.cacheable) await encode();
    const frames = await countVideoPackets(item.path, segmentSignal);
    if (Number(frames?.nb_read_packets) !== item.segment.frames || frames?.width !== width || frames?.height !== height) throw new Error(`Fast export segment ${item.index} has ${frames?.nb_read_packets ?? 0} of ${item.segment.frames} frames.`);
    done += item.segment.frames;
    // Percent, like the HyperFrames worker it stands in for; the final mux takes the last few.
    onProgress({ progress: Math.min(95, done / plan.frames * 95) });
  });
  // Join the encoded segments without re-encoding them, then mux in this export's sound.
  const list = join(directory, 'segments.txt');
  await writeFile(list, segments.map(item => `file '${item.path.replace(/'/g, "'\\''")}'\n`).join(''));
  const { audioInputs, graph, tracks } = await audioMix(plan, probe, pathOf, audioSourceOffsets);
  await run('ffmpeg', [
    '-hide_banner', '-v', 'error', '-nostdin', '-f', 'concat', '-safe', '0', '-i', list, ...audioInputs.flat(),
    ...graph.length ? ['-filter_complex', graph.join(';')] : [],
    '-map', '0:v:0', ...tracks.length ? ['-map', '[audio]', '-c:a', 'aac', '-b:a', '192k'] : [],
    '-c:v', 'copy', '-map_metadata', '-1', '-map_chapters', '-1', '-video_track_timescale', '90000',
    // No -avoid_negative_ts: it would move AAC priming into the timeline instead of the edit list.
    '-threads', String(renderResources().encodeThreads), '-movflags', '+faststart', '-y', output,
  ], { signal, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  // Never hand back a short or truncated file; the caller falls back to the browser renderer.
  const stream = await countVideoPackets(output, signal);
  if (Number(stream?.nb_read_packets) !== plan.frames || stream?.width !== width || stream?.height !== height) throw new Error(`Fast export produced ${stream?.nb_read_packets ?? 0} of ${plan.frames} frames at ${stream?.width}x${stream?.height}.`);
  onProgress({ progress: 100 });
  return { frames: plan.frames, elapsedMs: performance.now() - started, segments: { total: segments.length, reused, encodedFrames } };
}

/** A segment without clip ids: a recut that recreates the same picture still hits the cache. */
function pixelsOf(segment: PlainExportPlan['video'][number]) {
  if (segment.kind === 'gap') return segment;
  if (segment.kind === 'clip') { const { clipId: _clipId, ...rest } = segment; return rest; }
  return { ...segment, layers: segment.layers.map(({ clipId: _clipId, ...rest }) => rest) };
}

/** One footage segment as its own H.264 file: black, one framed clip, or a stack, with its static text and images over it. */
async function encodeSegment(item: { index: number; segment: PlainExportPlan['video'][number]; overlays: { textIndex: number; first: number; end: number }[]; path: string }, plan: PlainExportPlan, pathOf: (assetId: string) => string, probe: (assetId: string) => Promise<SourceInfo>, raster: (index: number) => Promise<string>, quality: Quality, threads: number, signal: AbortSignal) {
  const { segment } = item, { fps, width, height } = plan;
  const inputs: string[][] = [], graph: string[] = [];
  if (segment.kind === 'gap') {
    graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${num((segment.frames + 1) / fps)},format=yuv420p,trim=end_frame=${segment.frames},setsar=1,setpts=PTS-STARTPTS[v]`);
  } else if (segment.kind === 'stack') {
    const keys = [...new Set(segment.layers.map(samplingKey))], sampled: { video: NonNullable<SourceInfo['video']> }[] = [];
    for (const key of keys) {
      const layer = segment.layers.find(entry => samplingKey(entry) === key)!, source = await probe(layer.assetId);
      if (!source.video || source.videoStreams !== 1) throw new Error('Fast export needs exactly one video stream per source.');
      if (!(layer.sourceStart < source.duration)) throw new Error('Video media start is outside the source duration.');
      sampled.push({ video: source.video });
      inputs.push([...source.video.vfr ? [] : ['-noaccurate_seek'], '-ss', ffmpegTime(layer.sourceStart), '-an', '-sn', '-dn', '-threads', '1', '-i', pathOf(layer.assetId)]);
    }
    graph.push(...stackChain(segment, 0, sampled, plan, 'v'));
  } else {
    const source = await probe(segment.assetId);
    if (!source.video || source.videoStreams !== 1) throw new Error('Fast export needs exactly one video stream per source.');
    if (!(segment.sourceStart < source.duration)) throw new Error('Video media start is outside the source duration.');
    // No input duration limit: a non-accurate seek starts at the previous keyframe with negative
    // timestamps, as in HyperFrames. Decoding stops once the clip's trim ends its chain.
    graph.push(`${clipChain(0, segment, source.video, plan)}[v]`);
    inputs.push([...source.video.vfr ? [] : ['-noaccurate_seek'], '-ss', ffmpegTime(segment.sourceStart), '-an', '-sn', '-dn', '-threads', '1', '-i', pathOf(segment.assetId)]);
  }
  // Static text and images, rasterized by the browser renderer, over the footage in paint order.
  let picture = 'v';
  for (const [index, overlay] of item.overlays.entries()) {
    inputs.push(['-i', await raster(overlay.textIndex)]);
    graph.push(`[${picture}][${inputs.length - 1}:v]overlay=x=0:y=0:eof_action=repeat:format=yuv420:enable=between(n\\,${overlay.first}\\,${overlay.end - 1})[t${index}]`);
    picture = `t${index}`;
  }
  graph.push(`[${picture}]format=yuv420p,setsar=1[picture]`);
  await run('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-filter_complex_threads', '1', ...inputs.flat(), '-filter_complex', graph.join(';'), '-map', '[picture]', '-an', '-map_metadata', '-1', '-map_chapters', '-1', ...encoderArgs(quality, threads), '-r', String(fps), '-frames:v', String(segment.frames), '-y', item.path], { signal, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
}
