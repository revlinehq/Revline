import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { PlainExportPlan } from '../editor/plain-export';
import { RENDER_X264, renderResources } from '../render-resources.mjs';

const run = promisify(execFile);
type Quality = keyof typeof RENDER_X264;
type Child = ReturnType<typeof spawn>;
type SourceInfo = {
  duration: number;
  video?: { codec: string; pixFmt: string; height: number; matrix?: string; range?: string; transfer?: string; primaries?: string; vfr: boolean; alphaTagged: boolean };
  videoStreams: number; audioStreams: number; audioChannels?: number;
};
type ProbeStream = { codec_type?: string; codec_name?: string; pix_fmt?: string; height?: number; color_space?: string; color_range?: string; color_transfer?: string; color_primaries?: string; r_frame_rate?: string; avg_frame_rate?: string; channels?: number; disposition?: { attached_pic?: number }; tags?: { alpha_mode?: string } };

// Every open clip input holds a decoder and queued frames (about 25 MiB at 1080p), so footage
// comes from sequential FFmpeg processes of at most this many clips, piped as raw frames into
// one encoder. The encoder still writes one continuous H.264 stream, like the browser path.
const CLIPS_PER_PRODUCER = 8;

const known = (value?: string) => value && value !== 'unknown' && value !== 'reserved' ? value : undefined;
const rate = (value?: string) => { const [n, d] = (value ?? '').split('/').map(Number); return n > 0 && d > 0 ? n / d : 0; };
// Fixed notation keeps FFmpeg expressions free of exponents and locale effects.
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

/** One clip: HyperFrames' frame sampling, speed mapping, end hold and framing, as one filter chain. */
function clipChain(input: number, segment: Extract<PlainExportPlan['video'][number], { kind: 'clip' }>, video: NonNullable<SourceInfo['video']>, plan: PlainExportPlan) {
  const { fps, width, height } = plan, { phase, playbackRate: r, frames } = segment;
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
  // crop and pad round odd offsets down to the 4:2:0 chroma grid; exact crops keep the luma
  // placement of the browser framing, so odd contain bars pad one extra row/column first.
  const odd = { x: segment.x % 2, y: segment.y % 2 };
  const place = segment.fit === 'cover' ? `crop=${width}:${height}:${segment.x}:${segment.y}:exact=1`
    : odd.x || odd.y ? `pad=${width + 2 * odd.x}:${height + 2 * odd.y}:${segment.x + odd.x}:${segment.y + odd.y}:black,crop=${width}:${height}:${odd.x}:${odd.y}:exact=1`
      : `pad=${width}:${height}:${segment.x}:${segment.y}:black`;
  return `[${input}:v:0]${sample},${hold}${remap},trim=end_frame=${frames},${colorFilters(video, segment.scaleWidth, segment.scaleHeight)},${place},setsar=1,setpts=PTS-STARTPTS`;
}

function trackChild(child: Child, name: string) {
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, killed) => code === 0 ? resolve() : reject(new Error(`Fast export ${name} exited with ${code ?? killed}: ${stderr.trim().slice(-800)}`)));
  });
  exited.catch(() => {});
  return exited;
}

export type PlainExportResult = { frames: number; elapsedMs: number };

/**
 * Render an eligible plain timeline without a browser: per-clip seeks with
 * HyperFrames-identical frame sampling and framing, black gaps, and the native
 * producer's per-track audio chain and mix, encoded with its export settings.
 */
export async function renderPlainExport(directory: string, output: string, plan: PlainExportPlan, assetUrls: Record<string, string>, audioSourceOffsets: Record<string, number>, quality: Quality, onProgress: (render: { progress: number }) => void, signal: AbortSignal): Promise<PlainExportResult> {
  signal.throwIfAborted();
  try {
    return await render(directory, output, plan, assetUrls, audioSourceOffsets, quality, onProgress, signal);
  } catch (error) {
    // Probes, children and the output check all report cancellation the same way.
    if (signal.aborted) throw new Error('The render was cancelled.');
    throw error;
  }
}

async function render(directory: string, output: string, plan: PlainExportPlan, assetUrls: Record<string, string>, audioSourceOffsets: Record<string, number>, quality: Quality, onProgress: (render: { progress: number }) => void, signal: AbortSignal): Promise<PlainExportResult> {
  const started = performance.now();
  const pathOf = (assetId: string) => {
    const url = assetUrls[assetId];
    if (!url?.startsWith('./')) throw new Error('Fast export source media is unavailable.');
    return join(directory, url.slice(2));
  };
  const sources = new Map<string, Promise<SourceInfo>>();
  const probe = (assetId: string) => { if (!sources.has(assetId)) sources.set(assetId, probeSource(pathOf(assetId), signal)); return sources.get(assetId)!; };
  await Promise.all([...plan.video.flatMap(segment => segment.kind === 'clip' ? [segment.assetId] : []), ...plan.audio.map(track => track.assetId)].map(probe));
  const { fps, width, height } = plan;
  const frameBytes = width * height * 3 / 2;
  // Footage runs of at most CLIPS_PER_PRODUCER clips; gaps are synthesized and open no input.
  const runs: { segments: PlainExportPlan['video']; frames: number; clips: number }[] = [];
  for (const segment of plan.video) {
    let last = runs.at(-1);
    if (!last || segment.kind === 'clip' && last.clips >= CLIPS_PER_PRODUCER) runs.push(last = { segments: [], frames: 0, clips: 0 });
    last.segments.push(segment);
    last.frames += segment.frames;
    if (segment.kind === 'clip') last.clips++;
  }
  const producers: string[][] = [];
  for (const footage of runs) {
    const inputs: string[][] = [], graph: string[] = [], labels: string[] = [];
    for (const [index, segment] of footage.segments.entries()) {
      labels.push(`[v${index}]`);
      if (segment.kind === 'gap') {
        graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${num((segment.frames + 1) / fps)},format=yuv420p,trim=end_frame=${segment.frames},setsar=1,setpts=PTS-STARTPTS[v${index}]`);
        continue;
      }
      const source = await probe(segment.assetId);
      if (!source.video || source.videoStreams !== 1) throw new Error('Fast export needs exactly one video stream per source.');
      if (!(segment.sourceStart < source.duration)) throw new Error('Video media start is outside the source duration.');
      // No input duration limit: a non-accurate seek starts at the previous keyframe with negative
      // timestamps, as in HyperFrames. Decoding stops once the clip's trim ends its chain.
      graph.push(`${clipChain(inputs.length, segment, source.video, plan)}[v${index}]`);
      inputs.push([...source.video.vfr ? [] : ['-noaccurate_seek'], '-ss', num(segment.sourceStart), '-an', '-sn', '-dn', '-threads', '1', '-i', pathOf(segment.assetId)]);
    }
    graph.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0[video]`);
    producers.push(['-hide_banner', '-v', 'error', '-nostdin', '-filter_complex_threads', '1', ...inputs.flat(), '-filter_complex', graph.join(';'), '-map', '[video]', '-frames:v', String(footage.frames), '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1']);
  }
  const audioInputs: string[][] = [], graph: string[] = [], tracks: string[] = [];
  for (const track of plan.audio) {
    const source = await probe(track.assetId);
    if (source.audioStreams === 0) continue;
    if (source.audioStreams !== 1) throw new Error('Fast export needs at most one audio stream per source.');
    const offset = track.kind === 'audio' ? audioSourceOffsets[track.assetId] ?? 0 : 0;
    // Input 0 is the raw footage pipe. Then the native producer's prepared track: accurate
    // seek, stereo PCM at 48 kHz with atempo, gain baked into 16-bit samples, fades, delay.
    const input = audioInputs.length + 1;
    audioInputs.push(['-ss', num(Math.max(0, track.sourceStart - offset)), '-t', num(track.duration * track.playbackRate), '-vn', '-sn', '-dn', '-threads', '1', '-i', pathOf(track.assetId)]);
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
  const x264 = RENDER_X264[quality];
  const params = x264.preset === 'ultrafast' ? 'aq-mode=3' : 'aq-mode=3:aq-strength=0.8:deblock=1,1';
  const encoder = [
    '-hide_banner', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-filter_complex_threads', '1',
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${width}x${height}`, '-framerate', String(fps), '-i', 'pipe:0',
    ...audioInputs.flat(),
    ...graph.length ? ['-filter_complex', graph.join(';')] : [],
    '-map', '0:v', ...tracks.length ? ['-map', '[audio]'] : [],
    '-map_metadata', '-1', '-map_chapters', '-1',
    // HyperFrames' buildEncoderArgs for SDR H.264 MP4, with Revline's preset and CRF.
    '-c:v', 'libx264', '-preset', x264.preset, '-crf', String(x264.crf), '-bf', '0',
    '-x264-params', `${params}:colorprim=bt709:transfer=bt709:colormatrix=bt709`,
    '-colorspace:v', 'bt709', '-color_primaries:v', 'bt709', '-color_trc:v', 'bt709', '-color_range', 'tv',
    '-video_track_timescale', '90000', '-pix_fmt', 'yuv420p', '-r', String(fps), '-frames:v', String(plan.frames),
    ...tracks.length ? ['-c:a', 'aac', '-b:a', '192k'] : [],
    // No -avoid_negative_ts: it would move AAC priming into the timeline instead of the edit list.
    '-threads', String(renderResources().encodeThreads), '-movflags', '+faststart',
    '-y', output,
  ];
  const children = new Set<Child>();
  const stop = () => { for (const child of children) { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10_000).unref(); } };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const encode = spawn('ffmpeg', encoder, { stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(encode);
    const encoded = trackChild(encode, 'encoder');
    let pending = '';
    encode.stdout!.on('data', (chunk: Buffer) => {
      const lines = (pending + chunk.toString()).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const frame = /^frame=(\d+)/.exec(line);
        // Percent, like the HyperFrames worker it stands in for.
        if (frame) onProgress({ progress: Math.min(100, Number(frame[1]) / plan.frames * 100) });
      }
    });
    // An encoder that exits early surfaces through its exit status, not these pipe errors.
    encode.stdin!.on('error', () => {});
    const feed = async () => {
      for (const [index, args] of producers.entries()) {
        signal.throwIfAborted();
        const produce = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        children.add(produce);
        const produced = trackChild(produce, 'footage producer');
        let bytes = 0;
        produce.stdout!.on('data', (chunk: Buffer) => { bytes += chunk.length; });
        produce.stdout!.pipe(encode.stdin!, { end: false });
        await Promise.race([produced, encoded]);
        await produced;
        children.delete(produce);
        if (bytes !== runs[index].frames * frameBytes) throw new Error(`Fast export footage run ${index} produced ${bytes / frameBytes} of ${runs[index].frames} frames.`);
      }
      encode.stdin!.end();
    };
    await Promise.all([feed().catch(error => { stop(); throw error; }), encoded]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
  // Never hand back a short or truncated file; the caller falls back to the browser renderer.
  const { stdout } = await run('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets,width,height', '-of', 'json', output], { signal, timeout: 60_000, maxBuffer: 1024 * 1024 });
  const stream = (JSON.parse(stdout) as { streams?: { nb_read_packets?: string; width?: number; height?: number }[] }).streams?.[0];
  if (Number(stream?.nb_read_packets) !== plan.frames || stream?.width !== width || stream?.height !== height) throw new Error(`Fast export produced ${stream?.nb_read_packets ?? 0} of ${plan.frames} frames at ${stream?.width}x${stream?.height}.`);
  onProgress({ progress: 100 });
  return { frames: plan.frames, elapsedMs: performance.now() - started };
}
