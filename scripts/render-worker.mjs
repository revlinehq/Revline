// HyperFrames' internal Hono server replaces global Request/Response. Keep it
// inside this isolated, awaited process so Next's HTTP constructors stay intact.
import { createRenderJob, executeRenderJob, createConsoleLogger, resolveConfig } from '@hyperframes/producer';
import { RENDER_X264, configureRenderFfmpeg, configureRenderX264, renderResources } from '../lib/render-resources.mjs';
import { STRICT_EFFECTS_FAILURE, STRICT_EFFECTS_META, renderGpuConfig } from './render-gpu.mjs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  configureRenderX264(RENDER_X264[settings.quality]);
  // The low-memory profile forces one worker and per-frame screenshots. Keep it
  // for small hosts; PRODUCER_LOW_MEMORY_MODE still overrides this choice.
  const lowMemory = process.env.PRODUCER_LOW_MEMORY_MODE ? {} : { lowMemoryMode: resources.lowMemory };
  // Servers render with software GL, where HyperFrames otherwise forces per-frame
  // screenshots. BeginFrame capture (Linux) streams frames into the encoder instead:
  // measured 2.6-3x faster capture with SSIM >= 0.997 against screenshot output, and no
  // captured-frame files on disk (a 4K60 export needed ~16 GB of them). Other platforms
  // keep screenshots automatically. PRODUCER_FORCE_SCREENSHOT=true restores the old path.
  const forceScreenshot = process.env.PRODUCER_FORCE_SCREENSHOT === 'true';
  const render = async gpu => {
    const producerConfig = resolveConfig({ concurrency: resources.workers, ...lowMemory, frameDataUriCacheBytesLimitMb: 128, forceScreenshot, ...gpu });
    const job = createRenderJob({ producerConfig, fps: settings.fps, quality: settings.quality, workers: resources.workers, strictness: 'strict', logger: createConsoleLogger(['debug', 'info', 'warn', 'error'].includes(process.env.REVLINE_RENDER_LOG_LEVEL) ? process.env.REVLINE_RENDER_LOG_LEVEL : 'error') });
    try { await executeRenderJob(job, directory, output, progress => report({ type: 'progress', progress: progress.progress }), controller.signal); }
    catch (error) { throw job.error && !controller.signal.aborted ? new Error(job.error, { cause: error }) : error; }
    if (job.status !== 'complete') throw new Error(job.error || 'The render did not finish.');
    return job;
  };
  const gpu = await renderGpuConfig(directory);
  let job;
  if (gpu.browserGpuMode === 'hardware') {
    // A GPU that passed the preflight can still drop an effect mid-render (a lost WebGL context).
    // Strict compositions fail that frame instead of shipping the raw source; render again on SwiftShader.
    const page = join(directory, 'index.html'), html = await readFile(page, 'utf8');
    await writeFile(page, html.replace('<head>', `<head>${STRICT_EFFECTS_META}`));
    try { job = await render(gpu); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted || !message.includes(STRICT_EFFECTS_FAILURE)) throw error;
      console.error(`[revline] GPU render dropped an effect (${message.slice(0, 300)}); rendering again with SwiftShader.`);
      await writeFile(page, html);
      await rm(output, { force: true });
      job = await render({ browserGpuMode: 'software' });
    } finally { await writeFile(page, html); }
  } else job = await render(gpu);
  report({ type: 'complete', warnings: job.warnings.length });
} catch (error) {
  report({ type: 'error', message: error instanceof Error ? error.message.slice(0, 800) : 'The render worker failed.' });
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
