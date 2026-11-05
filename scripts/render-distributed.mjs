// Distributed export on Railway, built on HyperFrames' distributed primitives:
// plan once here, render chunks in parallel on short-lived containers (this container
// renders one too), then assemble. Same IPC contract as render-worker.mjs.
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createConsoleLogger, resolveConfig } from '@hyperframes/producer';
import { assemble, plan, renderChunk, resolvePlanAudioPath } from '@hyperframes/producer/distributed';
import { RENDER_X264, configureRenderFfmpeg, renderResources } from './render-resources.mjs';
import { exists, getFile, putFile, remove } from './render-artifacts.mjs';
import { exportChunkResources } from '../lib/export-chunk-resources.mjs';
import { randomUUID } from 'node:crypto';
import { launchRailwayChunk, railwayChunkRunning, removeRailwayChunk } from './render-railway-chunks.mjs';

const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('disconnect', () => controller.abort());
const report = message => { if (process.connected) process.send(message); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (event, fields = {}) => console.log(`[Render:trace] ${JSON.stringify({ phase: 'distributed', event, ...fields })}`);

function tar(directory, output) {
  return new Promise((accept, reject) => {
    const child = spawn('tar', ['-cf', output, '-C', directory, '.'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-500); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept() : reject(new Error(`Packing the export plan failed: ${stderr}`)));
  });
}

const launched = new Set();

let keys = [];
let scratch = [];
try {
  const [directory, output, serialized] = process.argv.slice(2);
  const settings = JSON.parse(serialized);
  if (!directory || !output || ![24, 30, 60].includes(settings.fps) || !['draft', 'standard', 'high'].includes(settings.quality) || !settings.exportId) throw new Error('Invalid distributed render settings.');
  const { chunkGuest, chunkEnv } = exportChunkResources({ guest: settings.chunkGuest, env: settings.chunkEnv });
  if (!process.env.RAILWAY_SERVICE_ID) throw new Error('Distributed exports require a Railway worker.');
  const signal = controller.signal;
  const resources = renderResources();
  configureRenderFfmpeg(directory, resources);
  const x264 = RENDER_X264[settings.quality];
  if (x264.preset !== x264.producerPreset) process.env.REVLINE_RENDER_X264_PRESET = `${x264.producerPreset}=${x264.preset}`;
  if (x264.crf !== x264.producerCrf) process.env.REVLINE_RENDER_X264_CRF = `${x264.producerCrf}=${x264.crf}`;
  const logger = createConsoleLogger(['debug', 'info', 'warn', 'error'].includes(process.env.REVLINE_RENDER_LOG_LEVEL) ? process.env.REVLINE_RENDER_LOG_LEVEL : 'error');
  // BeginFrame capture (see render-worker.mjs); the plan locks this config for every chunk.
  const producerConfig = resolveConfig({ concurrency: resources.workers, frameDataUriCacheBytesLimitMb: 128, forceScreenshot: process.env.PRODUCER_FORCE_SCREENSHOT === 'true' });
  // The plan copies the composition directory, so it must live outside it.
  const planDir = `${directory}-plan`;
  const startedAt = Date.now();
  report({ type: 'progress', progress: 2 });
  const planned = await plan(directory, {
    fps: settings.fps, width: settings.width, height: settings.height, format: 'mp4', codec: 'h264', quality: settings.quality,
    maxParallelChunks: settings.maxChunks, runtimeCap: 'none', hdrMode: 'force-sdr', strictness: 'strict',
    // Every chunk runs this same image, so its fonts match the planner's.
    rejectOnSystemFonts: false, failClosedFontFetch: false,
    producerConfig, logger, abortSignal: signal, planDirSizeLimitBytes: 4 * 1024 * 1024 * 1024,
  }, planDir);
  const count = planned.chunkCount;
  log('planned', { chunks: count, frames: planned.totalFrames, ms: Date.now() - startedAt });
  report({ type: 'progress', progress: 10 });
  const chunkPaths = Array.from({ length: count }, (_, index) => `${directory}-chunk-${index}.mp4`);
  scratch = [planDir, `${planDir}.tar`, ...chunkPaths];
  const prefix = `exports/${settings.exportId}/${randomUUID()}`;
  log('artifact-prefix', { prefix });
  const local = count - 1;
  const done = new Set();
  const progress = () => report({ type: 'progress', progress: 10 + Math.round(85 * done.size / count) });
  // This machine renders the last chunk while the others render remotely.
  const localChunk = renderChunk(planDir, local, chunkPaths[local]).then(() => { done.add(local); progress(); });
  // Awaited after the remote chunks; observed now so an early failure is not unhandled.
  localChunk.catch(() => {});
  if (count > 1) {
    const planTar = `${planDir}.tar`;
    await tar(planDir, planTar);
    await putFile(`${prefix}/plan.tar`, planTar, signal);
    keys.push(`${prefix}/plan.tar`);
    log('plan-uploaded', { ms: Date.now() - startedAt });
    const machineFor = new Map(), attempts = new Map(), nextStatusAt = new Map();
    const launch = async index => {
      const key = `${prefix}/chunk-${index}.mp4`;
      if (!keys.includes(key)) keys.push(key);
      attempts.set(index, (attempts.get(index) ?? 0) + 1);
      signal.throwIfAborted();
      const id = await launchRailwayChunk({ index, planKey: `${prefix}/plan.tar`, outKey: key, quality: settings.quality, chunkGuest, chunkEnv });
      machineFor.set(index, id); launched.add(id);
    };
    // Each launch makes several control requests; avoid an API burst.
    for (let index = 0; index < count - 1; index++) await launch(index);
    log('chunks-launched', { machines: count - 1, ms: Date.now() - startedAt });
    const deadline = Date.now() + 40 * 60_000;
    while (Array.from({ length: count - 1 }, (_, index) => index).some(index => !done.has(index))) {
      signal.throwIfAborted();
      if (Date.now() > deadline) throw new Error('Export chunks did not finish in time.');
      await wait(2000);
      for (let index = 0; index < count - 1; index++) {
        if (done.has(index)) continue;
        if (await exists(`${prefix}/chunk-${index}.mp4`, signal)) { done.add(index); progress(); continue; }
        // Railway's control API is rate-limited. Object storage remains the completion signal;
        // query a service's lifecycle at most every five minutes while it is busy.
        if (Date.now() < (nextStatusAt.get(index) ?? 0)) continue;
        nextStatusAt.set(index, Date.now() + 5 * 60_000);
        // A machine that exited without uploading failed; give its chunk one more machine.
        const running = await railwayChunkRunning(machineFor.get(index));
        if (running) continue;
        if (await exists(`${prefix}/chunk-${index}.mp4`, signal)) { done.add(index); progress(); continue; }
        if ((attempts.get(index) ?? 0) >= 2) throw new Error(`Export chunk ${index + 1} of ${count} failed twice.`);
        log('chunk-retry', { index });
        await launch(index);
      }
    }
    log('remote-chunks-done', { ms: Date.now() - startedAt });
    await Promise.all(Array.from({ length: count - 1 }, (_, index) => getFile(`${prefix}/chunk-${index}.mp4`, chunkPaths[index], signal)));
  }
  await localChunk;
  log('chunks-ready', { ms: Date.now() - startedAt });
  await mkdir(dirname(output), { recursive: true });
  await assemble(planDir, chunkPaths, resolvePlanAudioPath(planDir), output, { logger, abortSignal: signal });
  log('assembled', { ms: Date.now() - startedAt });
  report({ type: 'complete', warnings: 0 });
} catch (error) {
  report({ type: 'error', message: error instanceof Error ? error.message.slice(0, 800) : 'The distributed render failed.' });
  process.exitCode = 1;
} finally {
  // Remove temporary chunk services after completion or failure.
  for (const id of launched) await removeRailwayChunk(id).catch(() => log('chunk-cleanup-pending', { serviceId: id }));
  await Promise.all(keys.map(async key => { if (!await remove(key)) log('artifact-cleanup-pending', { key }); }));
  await Promise.all(scratch.map(path => rm(path, { recursive: true, force: true }).catch(() => log('scratch-cleanup-pending', { path }))));
  if (process.connected) process.disconnect();
}
