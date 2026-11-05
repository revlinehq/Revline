// HyperFrames' internal Hono server replaces global Request/Response. Keep it
// inside this isolated, awaited process so Next's HTTP constructors stay intact.
import { createRenderJob, executeRenderJob, createConsoleLogger, resolveConfig } from '@hyperframes/producer';
import { RENDER_X264, configureRenderFfmpeg, renderResources } from '../lib/render-resources.mjs';

const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('disconnect', () => controller.abort());

function report(message) {
  if (process.connected) process.send(message);
}

try {
  const [directory, output, serialized] = process.argv.slice(2);
  const settings = JSON.parse(serialized);
  if (!directory || !output || ![24, 30, 60].includes(settings.fps) || !['draft', 'standard', 'high'].includes(settings.quality)) throw new Error('Invalid render worker settings.');
  const resources = renderResources();
  configureRenderFfmpeg(directory, resources);
  // Cheaper compression searches at the same resolution and frame rate.
  // Standard keeps CRF 18; high moves from slow/CRF 15 to medium/CRF 16,
  // roughly halving its encode CPU for a small SSIM change.
  const x264 = RENDER_X264[settings.quality];
  if (x264.preset !== x264.producerPreset) process.env.REVLINE_RENDER_X264_PRESET = `${x264.producerPreset}=${x264.preset}`;
  if (x264.crf !== x264.producerCrf) process.env.REVLINE_RENDER_X264_CRF = `${x264.producerCrf}=${x264.crf}`;
  // The low-memory profile forces one worker and per-frame screenshots. Keep it
  // for small hosts; PRODUCER_LOW_MEMORY_MODE still overrides this choice.
  const lowMemory = process.env.PRODUCER_LOW_MEMORY_MODE ? {} : { lowMemoryMode: resources.lowMemory };
  // Servers render with software GL, where HyperFrames otherwise forces per-frame
  // screenshots. BeginFrame capture (Linux) streams frames into the encoder instead:
  // measured 2.6-3x faster capture with SSIM >= 0.997 against screenshot output, and no
  // captured-frame files on disk (a 4K60 export needed ~16 GB of them). Other platforms
  // keep screenshots automatically. PRODUCER_FORCE_SCREENSHOT=true restores the old path.
  const forceScreenshot = process.env.PRODUCER_FORCE_SCREENSHOT === 'true';
  const producerConfig = resolveConfig({ concurrency: resources.workers, ...lowMemory, frameDataUriCacheBytesLimitMb: 128, forceScreenshot });
  const job = createRenderJob({ producerConfig, fps: settings.fps, quality: settings.quality, workers: resources.workers, strictness: 'strict', logger: createConsoleLogger(['debug', 'info', 'warn', 'error'].includes(process.env.REVLINE_RENDER_LOG_LEVEL) ? process.env.REVLINE_RENDER_LOG_LEVEL : 'error') });
  await executeRenderJob(job, directory, output, progress => report({ type: 'progress', progress: progress.progress }), controller.signal);
  if (job.status !== 'complete') throw new Error('The render did not finish.');
  report({ type: 'complete', warnings: job.warnings.length });
} catch (error) {
  report({ type: 'error', message: error instanceof Error ? error.message.slice(0, 800) : 'The render worker failed.' });
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
