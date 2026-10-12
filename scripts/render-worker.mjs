// HyperFrames' internal Hono server replaces global Request/Response. Keep it
// inside this isolated, awaited process so Next's HTTP constructors stay intact.
import { createRenderJob, executeRenderJob, createConsoleLogger } from '@hyperframes/producer';

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
  const job = createRenderJob({ fps: settings.fps, quality: settings.quality, workers: 1, strictness: 'strict', logger: createConsoleLogger('error') });
  await executeRenderJob(job, directory, output, progress => report({ type: 'progress', progress: progress.progress }), controller.signal);
  if (job.status !== 'complete') throw new Error('The render did not finish.');
  report({ type: 'complete', warnings: job.warnings.length });
} catch (error) {
  report({ type: 'error', message: error instanceof Error ? error.message.slice(0, 800) : 'The render worker failed.' });
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
