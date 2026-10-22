// HyperFrames' internal Hono server replaces global Request/Response. Keep it
// inside this isolated, awaited process so Next's HTTP constructors stay intact.
import { createRenderJob, executeRenderJob, createConsoleLogger, resolveConfig } from '@hyperframes/producer';
import { configureRenderFfmpeg, renderResources } from './render-resources.mjs';

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
  configureRenderFfmpeg(directory);
  if(settings.quality==='standard')process.env.REVLINE_RENDER_STANDARD_PRESET='fast';
  // The low-memory profile forces one worker and per-frame screenshots. Keep it
  // for small hosts; PRODUCER_LOW_MEMORY_MODE still overrides this choice.
  const lowMemory = process.env.PRODUCER_LOW_MEMORY_MODE ? {} : { lowMemoryMode: resources.lowMemory };
  const producerConfig = resolveConfig({ concurrency: resources.workers, ...lowMemory, frameDataUriCacheBytesLimitMb: 128 });
  const job = createRenderJob({ producerConfig, fps: settings.fps, quality: settings.quality, workers: resources.workers, strictness: 'strict', logger: createConsoleLogger('error') });
  await executeRenderJob(job, directory, output, progress => report({ type: 'progress', progress: progress.progress }), controller.signal);
  if (job.status !== 'complete') throw new Error('The render did not finish.');
  report({ type: 'complete', warnings: job.warnings.length });
} catch (error) {
  report({ type: 'error', message: error instanceof Error ? error.message.slice(0, 800) : 'The render worker failed.' });
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
