import { fork } from 'node:child_process';
import { join } from 'node:path';

type Settings = { fps: number; quality: 'draft' | 'standard' | 'high' };
export type ReviewCaptureSettings={width:number;height:number;fps:number;times:number[];start:number;end:number;variants?:('edited'|'reference')[];pacing?:{width:number;height?:number;crop?:{x:number;y:number;w:number;h:number}}};

/** A dedicated process owns renderer globals and ends with its task signal. */
export function runRenderWorker(directory: string, output: string, settings: Settings, onProgress: (render: { progress: number }) => void, signal: AbortSignal): Promise<{ warnings: number }> {
  return runRendererProcess('render-worker.mjs',[directory,output,JSON.stringify(settings)],onProgress,signal);
}
/** Fly export machines: plan here, render chunks on parallel machines, assemble (render-distributed.mjs). */
export type DistributedSettings = Settings & { width: number; height: number; exportId: string; maxChunks: number; chunkGuest: { cpu_kind: string; cpus: number; memory_mb: number }; chunkEnv: Record<string, string> };
export function runDistributedRender(directory: string, output: string, settings: DistributedSettings, onProgress: (render: { progress: number }) => void, signal: AbortSignal): Promise<{ warnings: number }> {
  return runRendererProcess('render-distributed.mjs',[directory,output,JSON.stringify(settings)],onProgress,signal);
}
export function runCompositionCapture(directory:string,settings:ReviewCaptureSettings,signal:AbortSignal){
  return runRendererProcess('composition-review-worker.mjs',[directory,JSON.stringify(settings)],()=>{},signal);
}
function runRendererProcess(script:string,args:string[],onProgress:(render:{progress:number})=>void,signal:AbortSignal):Promise<{warnings:number}>{
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // This Node entry runs outside the bundle; outputFileTracingIncludes packages it.
    const worker = fork(/* turbopackIgnore: true */ join(process.cwd(), 'scripts',script),args, { execArgv: [], silent: true });
    let completed: { warnings: number } | undefined;
    let failure: Error | undefined;
    let stderr = '';
    let forceStop: ReturnType<typeof setTimeout> | undefined;
    // Drain diagnostics without buffering large compiler/browser logs into Next.
    // REVLINE_RENDER_LOG_LEVEL (export machines) forwards the renderer's stage timings and
    // warnings; per-worker chatter would push them out of the host's bounded log buffer.
    if (process.env.REVLINE_RENDER_LOG_LEVEL) {
      let pending = '';
      worker.stdout?.on('data', (chunk: Buffer) => {
        const lines = (pending + chunk.toString()).split('\n'); pending = lines.pop() ?? '';
        for (const line of lines) if (/Render:trace|WARN|ERROR/.test(line) && !/Parallel capture worker phase/.test(line)) console.log(line.slice(0, 2000));
      });
    } else worker.stdout?.resume();
    worker.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); if (process.env.REVLINE_RENDER_LOG_LEVEL) process.stderr.write(chunk); });
    const cancel = () => {
      worker.kill('SIGTERM');
      forceStop = setTimeout(() => worker.kill('SIGKILL'), 10_000);
      forceStop.unref();
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    worker.on('message', (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || !('type' in raw)) return;
      const message = raw as { type: string; progress?: number; warnings?: number; message?: string };
      if (message.type === 'progress' && typeof message.progress === 'number' && Number.isFinite(message.progress)) onProgress({ progress: message.progress });
      if (message.type === 'complete' && typeof message.warnings === 'number') completed = { warnings: message.warnings };
      if (message.type === 'error') failure = new Error(message.message || 'The render worker failed.');
    });
    worker.on('error', error => { failure = error; });
    worker.on('close', code => {
      signal.removeEventListener('abort', cancel);
      if (forceStop) clearTimeout(forceStop);
      if (signal.aborted) { reject(new Error('The render was cancelled.')); return; }
      if (code === 0 && completed) { resolve(completed); return; }
      if (stderr) console.error('Render worker exited:', stderr);
      reject(failure ?? new Error('The video render worker stopped before completing.'));
    });
  });
}
