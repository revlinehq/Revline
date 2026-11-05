// Railway chunk worker: render one slice of a distributed export plan and upload it.
// Started by render-distributed.mjs with REVLINE_CHUNK_* env; the machine is
// auto-destroyed when this process exits. Exit 0 only once the chunk is stored.
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderChunk } from '@hyperframes/producer/distributed';
import { RENDER_X264, configureRenderFfmpeg, renderResources } from './render-resources.mjs';
import { getTar, putFile } from './render-artifacts.mjs';

const { REVLINE_CHUNK_PLAN_KEY: planKey, REVLINE_CHUNK_INDEX: rawIndex, REVLINE_CHUNK_OUT_KEY: outKey, REVLINE_CHUNK_QUALITY: quality = 'standard' } = process.env;
const index = Number(rawIndex);
const startedAt = Date.now();
const log = (event, fields = {}) => console.log(JSON.stringify({ event, index, elapsedMs: Date.now() - startedAt, ...fields }));
try {
  if (!planKey || !outKey || !Number.isInteger(index) || index < 0) throw new Error('Chunk settings are missing.');
  const signal = AbortSignal.timeout(30 * 60_000);
  const work = await mkdtemp(join(tmpdir(), 'revline-chunk-')), planDir = join(work, 'plan');
  await mkdir(planDir);
  configureRenderFfmpeg(work, renderResources());
  // The same cheaper x264 searches as single-machine exports (see render-worker.mjs).
  const x264 = RENDER_X264[quality] ?? RENDER_X264.standard;
  if (x264.preset !== x264.producerPreset) process.env.REVLINE_RENDER_X264_PRESET = `${x264.producerPreset}=${x264.preset}`;
  if (x264.crf !== x264.producerCrf) process.env.REVLINE_RENDER_X264_CRF = `${x264.producerCrf}=${x264.crf}`;
  await getTar(planKey, planDir, signal);
  log('chunk-plan-ready');
  const result = await renderChunk(planDir, index, join(work, 'chunk.mp4'));
  if (result.outputKind !== 'file') throw new Error('Chunk did not produce a video file.');
  log('chunk-rendered', { frames: result.framesEncoded, captureMs: result.captureStageMs, encodeMs: result.encodeStageMs, workers: result.workers, captureMode: result.captureMode });
  await putFile(outKey, result.outputPath, signal);
  log('chunk-done');
  process.exit(0);
} catch (error) {
  log('chunk-failed', { error: error instanceof Error ? error.message.slice(0, 800) : String(error) });
  process.exit(1);
}
