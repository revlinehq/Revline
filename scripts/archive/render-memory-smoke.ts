import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { mkdir, writeFile, copyFile, stat, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateComposition } from '../../lib/editor/composition';
import type { Timeline } from '../../lib/editor/types';
import { renderResources } from '../render-resources.mjs';

async function main() {
const directory = process.env.REVLINE_RENDER_MEMORY_DIR ?? '/tmp/revline-render-memory-smoke';
const label = process.env.REVLINE_RENDER_MEMORY_LABEL ?? 'bounded';
await mkdir(directory, { recursive: true });
const source = join(directory, 'source.mp4');
try { await stat(source); } catch {
  execFileSync('ffmpeg', ['-v', 'error', '-filter_threads', '1', '-f', 'lavfi', '-i', 'testsrc2=s=720x720:r=30:d=4', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-y', source]);
}
for (const name of ['gsap.min.js', 'visual-effects.js', 'remotion-runtime.js']) await copyFile(join(process.cwd(), 'public/vendor', name), join(directory, name));
const timeline: Timeline = { fps: 30, aspectRatio: 'landscape', clips: Array.from({ length: 15 }, (_, index) => ({ id: `cut-${index}`, kind: 'video', assetId: 'source', start: index / 10, duration: .1, sourceStart: index / 5, volume: 0 })) };
const html = generateComposition(timeline, [{ _id: 'source', fileName: 'source.mp4', kind: 'video', url: './source.mp4' }], { resolution: 720, fps: 30, gsapUrl: './gsap.min.js', visualEffectsUrl: './visual-effects.js', remotionRuntimeUrl: './remotion-runtime.js' });
await writeFile(join(directory, 'index.html'), html);
const output = join(directory, `${label}.mp4`);
const cache = join(directory, `${label}-cache`);
await rm(cache, { recursive: true, force: true });
const worker = fork(join(process.cwd(), 'scripts/render-worker.mjs'), [directory, output, JSON.stringify({ fps: 30, quality: 'draft' })], { execArgv: [], silent: true, env: { ...process.env, HYPERFRAMES_EXTRACT_CACHE_DIR: cache } });
let peakFfmpeg = 0, peakRssKiB = 0, complete = false, error = '';
const started = Date.now();
worker.stdout?.resume();
worker.stderr?.on('data', chunk => { error = (error + chunk.toString()).slice(-4000); });
worker.on('message', raw => { const message = raw as { type: string; message?: string }; if (message.type === 'complete') complete = true; if (message.type === 'error') error = message.message ?? 'Render failed'; });
function sample() {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,comm=,rss='], { encoding: 'utf8' }).trim().split('\n').map(line => { const [pid, ppid, name, rss] = line.trim().split(/\s+/); return { pid: Number(pid), ppid: Number(ppid), name, rss: Number(rss) }; });
  const descendants = new Set([worker.pid]);
  for (let changed = true; changed;) { changed = false; for (const row of rows) if (descendants.has(row.ppid) && !descendants.has(row.pid)) { descendants.add(row.pid); changed = true; } }
  const owned = rows.filter(row => descendants.has(row.pid));
  peakFfmpeg = Math.max(peakFfmpeg, owned.filter(row => row.name === 'ffmpeg' && row.rss > 0).length);
  peakRssKiB = Math.max(peakRssKiB, owned.reduce((sum, row) => sum + row.rss, 0));
}
const sampler = setInterval(sample, 35);
const timeout = setTimeout(() => worker.kill('SIGTERM'), 90_000);
const code = await new Promise<number | null>(resolve => worker.on('close', resolve));
clearInterval(sampler); clearTimeout(timeout);
assert.equal(code, 0, error);
assert.ok(complete, error);
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate', '-show_entries', 'format=duration', '-of', 'json', output], { encoding: 'utf8' }));
assert.ok(Math.abs(Number(probe.format.duration) - 1.5) < .05);
assert.ok(probe.streams.some((stream: {codec_name: string; width: number; height: number; avg_frame_rate: string}) => stream.codec_name === 'h264' && stream.width === 1280 && stream.height === 720 && stream.avg_frame_rate === '30/1'));
const samples = [0.05, .55, 1.05].map(time => [...execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-ss', String(time), '-i', output, '-vf', 'scale=8:8', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])]);
const metrics = { label, peakFfmpeg, peakRssMiB: Number((peakRssKiB / 1024).toFixed(1)), elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(2)), samples };
await writeFile(join(directory, `${label}.json`), JSON.stringify(metrics));
console.log(JSON.stringify({ ...metrics, samples: samples.map(sample => sample.slice(0, 3)), output }));
const baselineContents = label === 'baseline' ? null : await readFile(join(directory, 'baseline.json'), 'utf8').catch(() => null);
if (baselineContents) {
  const baseline = JSON.parse(baselineContents);
  const differences = samples.flatMap((sample, index) => sample.map((value, channel) => Math.abs(value - baseline.samples[index][channel])));
  assert.ok(Math.max(...differences) <= 4 && differences.reduce((sum, value) => sum + value, 0) / differences.length < .1, 'Bounding decoder threads changed rendered pixels beyond codec rounding.');
}
const { ffmpegSlots } = renderResources();
assert.ok(peakFfmpeg <= ffmpegSlots, `Export ran ${peakFfmpeg} FFmpeg decoders concurrently (expected at most ${ffmpegSlots}).`);
await verifyCancellation(directory);


}
async function verifyCancellation(directory: string) {
  const worker = fork(join(process.cwd(), 'scripts/render-worker.mjs'), [directory, join(directory, 'cancelled.mp4'), JSON.stringify({ fps: 30, quality: 'draft' })], { execArgv: [], silent: true, env: { ...process.env, HYPERFRAMES_EXTRACT_CACHE_DIR: join(directory, `cancel-cache-${Date.now()}`) } });
  worker.stdout?.resume(); worker.stderr?.resume();
  let cancelledAt = 0;
  const ownedPids = new Set<number>();
  const sample = () => {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(line => { const [pid, ppid, name] = line.trim().split(/\s+/); return { pid: Number(pid), ppid: Number(ppid), name }; });
    const descendants = new Set([worker.pid]);
    for (let changed = true; changed;) { changed = false; for (const row of rows) if (descendants.has(row.ppid) && !descendants.has(row.pid)) { descendants.add(row.pid); changed = true; } }
    const owned = rows.filter(row => descendants.has(row.pid));
    for (const row of owned) ownedPids.add(row.pid);
    if (!cancelledAt && owned.some(row => row.name === 'ffmpeg') && owned.some(row => row.name === 'flock')) { cancelledAt = Date.now(); worker.kill('SIGTERM'); }
  };
  const sampler = setInterval(sample, 20);
  const timeout = setTimeout(() => worker.kill('SIGTERM'), 15_000);
  const code = await new Promise<number | null>(resolve => worker.on('close', resolve));
  clearInterval(sampler); clearTimeout(timeout);
  assert.ok(cancelledAt, 'Cancellation fixture did not observe active and queued decoders.');
  assert.notEqual(code, 0, 'Cancelled render incorrectly succeeded.');
  assert.ok(Date.now() - cancelledAt < 5000, 'Cancelling left render work running.');
  await new Promise(resolve => setTimeout(resolve, 300));
  const remaining = execFileSync('ps', ['-eo', 'pid='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number).filter(pid => ownedPids.has(pid));
  assert.equal(remaining.length, 0, `Cancellation left owned processes alive: ${remaining.join(', ')}`);
  console.log('Cancellation passed with both an active decoder and queued flock children; every owned process exited.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
