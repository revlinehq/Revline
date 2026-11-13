import { execFileSync, fork } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Settings = { fps: number; quality: 'draft' | 'standard' | 'high' };
/** One renderer report: overall percent, the HyperFrames stage and, while frames move, its frame counts. */
export type RenderProgress = { progress: number; stage?: string; step?: { code: string; done: number; total: number } };
/** A browser render whose frames stopped moving, stopped by the watchdog below. */
export class RenderStallError extends Error {
  constructor(public stage: string, public step: RenderProgress['step'], public idleMs: number) {
    super(`The browser render stalled: no progress for ${Math.round(idleMs / 1000)}s during ${stage || 'startup'}${step?.total ? ` at ${step.code} ${step.done}/${step.total}` : ''}.`);
  }
}
// A frame normally lands every few hundred milliseconds (the 2026-11-13 export sat at 0% CPU for 5+
// minutes behind a live lease). HyperFrames restarts a capture session itself after 60 s without a frame,
// so capture gets two minutes. Compiling, extracting video frames, starting browsers and the encode flush
// after the last frame report less often and get longer budgets.
const STALL_MS: Record<string, number> = { capture: 120_000, start_browsers: 120_000, encode: 180_000, assemble: 180_000 };
const STALL_DEFAULT_MS = 300_000;

/** Every process below `root` (/proc on Linux, `ps` elsewhere). Puppeteer starts Chrome in its own process
 * group, so a group kill misses it, and Chrome orphaned by a killed worker keeps running; the stall path kills this list. */
function descendants(root: number): number[] {
  const children = new Map<number, number[]>();
  const add = (pid: number, parent: number) => children.set(parent, [...children.get(parent) ?? [], pid]);
  try {
    if (process.platform === 'linux') {
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try { const stat = readFileSync(`/proc/${entry}/stat`, 'utf8'); add(Number(entry), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])); }
        catch { /* the process exited */ }
      }
    } else for (const line of execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 5_000 }).split('\n')) {
      const [pid, parent] = line.trim().split(/\s+/).map(Number);
      if (pid > 0) add(pid, parent);
    }
  } catch { return []; }
  const found: number[] = [], pending = [root];
  while (pending.length) for (const child of children.get(pending.pop()!) ?? []) { found.push(child); pending.push(child); }
  return found;
}
export type ReviewCaptureSettings={width:number;height:number;fps:number;times:number[];start:number;end:number;variants?:('edited'|'reference')[];sparse?:boolean;pacing?:{width:number;height?:number;crop?:{x:number;y:number;w:number;h:number}}};

/** A dedicated process owns renderer globals and ends with its task signal. */
export function runRenderWorker(directory: string, output: string, settings: Settings, onProgress: (render: RenderProgress) => void, signal: AbortSignal): Promise<{ warnings: number }> {
  return runRendererProcess('render-worker.mjs',[directory,output,JSON.stringify(settings)],onProgress,signal,true);
}
/** dedicated export workers: plan here, render chunks on parallel machines, assemble (render-distributed.mjs). */
export type DistributedSettings = Settings & { width: number; height: number; exportId: string; maxChunks: number; chunkGuest: { cpu_kind: string; cpus: number; memory_mb: number }; chunkEnv: Record<string, string> };
export function runDistributedRender(directory: string, output: string, settings: DistributedSettings, onProgress: (render: RenderProgress) => void, signal: AbortSignal): Promise<{ warnings: number }> {
  return runRendererProcess('render-distributed.mjs',[directory,output,JSON.stringify(settings)],onProgress,signal);
}
export function runCompositionCapture(directory:string,settings:ReviewCaptureSettings,signal:AbortSignal){
  return runRendererProcess('composition-review-worker.mjs',[directory,JSON.stringify(settings)],()=>{},signal);
}
function runRendererProcess(script:string,args:string[],onProgress:(render:RenderProgress)=>void,signal:AbortSignal,watch=false):Promise<{warnings:number}>{
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
    let stderrLine = '';
    worker.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
      if (process.env.REVLINE_RENDER_LOG_LEVEL) { process.stderr.write(chunk); return; }
      // GPU mode: say whether frames draw on the GPU or fell back to SwiftShader (scripts/render-gpu.mjs).
      const lines = (stderrLine + chunk.toString()).split('\n'); stderrLine = lines.pop()!.slice(-2000);
      for (const line of lines) if (line.startsWith('[revline] GPU')) console.log(`Export renderer: ${line.slice(0, 500)}`);
    });
    const cancel = () => {
      worker.kill('SIGTERM');
      forceStop = setTimeout(() => worker.kill('SIGKILL'), 10_000);
      forceStop.unref();
    };
    // Stall watchdog: any new stage, frame count or percent is progress. Silence past the stage's budget
    // kills the renderer and its browsers at once (a hung browser would block a graceful stop) and rejects
    // with RenderStallError for the caller to retry.
    let last: RenderProgress = { progress: 0 }, advancedAt = Date.now(), stalled: RenderStallError | undefined;
    const watchdog = watch ? setInterval(() => {
      const idle = Date.now() - advancedAt;
      // Capture that reached its last frame is flushing the encoder: the encode budget applies.
      const code = last.step?.code === 'capture' && last.step.total > 0 && last.step.done >= last.step.total ? 'encode' : last.step?.code ?? '';
      if (stalled || idle < (STALL_MS[code] ?? STALL_DEFAULT_MS)) return;
      stalled = new RenderStallError(last.stage ?? '', last.step, idle);
      const tree = worker.pid ? descendants(worker.pid) : [];
      worker.kill('SIGKILL');
      for (const pid of tree) try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }, 5_000) : undefined;
    watchdog?.unref();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    worker.on('message', (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || !('type' in raw)) return;
      const message = raw as { type: string; progress?: number; warnings?: number; message?: string; stage?: string; step?: RenderProgress['step'] };
      if (message.type === 'progress' && typeof message.progress === 'number' && Number.isFinite(message.progress)) {
        const next: RenderProgress = { progress: message.progress, ...(typeof message.stage === 'string' ? { stage: message.stage } : {}), ...(message.step && typeof message.step.done === 'number' && typeof message.step.total === 'number' ? { step: { code: String(message.step.code), done: message.step.done, total: message.step.total } } : {}) };
        if (next.progress !== last.progress || next.stage !== last.stage || next.step?.code !== last.step?.code || next.step?.done !== last.step?.done) advancedAt = Date.now();
        last = next;
        onProgress(next);
      }
      if (message.type === 'complete' && typeof message.warnings === 'number') completed = { warnings: message.warnings };
      if (message.type === 'error') failure = new Error(message.message || 'The render worker failed.');
    });
    worker.on('error', error => { failure = error; });
    worker.on('close', code => {
      signal.removeEventListener('abort', cancel);
      if (forceStop) clearTimeout(forceStop);
      if (watchdog) clearInterval(watchdog);
      if (signal.aborted) { reject(new Error('The render was cancelled.')); return; }
      if (stalled) { reject(stalled); return; }
      if (code === 0 && completed) { resolve(completed); return; }
      if (stderr) console.error('Render worker exited:', stderr);
      reject(failure ?? new Error('The video render worker stopped before completing.'));
    });
  });
}
