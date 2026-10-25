import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import { processMediaTask } from '../../lib/server/media-task-runner';
import { isMediaLeaseLost, isRetryableAnalysisError, MEDIA_TASK_LEASE_MS } from '../../lib/media-analysis/errors';
import type { MediaTaskActivity } from '../../lib/media-analysis/activity';
import { MEDIA_PROCESSOR_VERSION } from '../../lib/media-analysis/processor-version';

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const workerSecret = process.env.RENDER_WORKER_SECRET;
if (!convexUrl || !workerSecret) throw new Error('Configure the production Convex URL and media worker secret.');
const concurrency = Number(process.env.MEDIA_WORKER_CONCURRENCY ?? 1);
// The Ultra slot claims only Ultra exports; regular slots leave them to it.
const lane = process.env.MEDIA_LANE === 'ultra' ? { lane: 'ultra' as const } : {};
// Staying warm after work spares the next export a container and Chromium cold
// start; idle containers still bill memory/disk, so this stays bounded.
const idleMs = Number(process.env.MEDIA_WORKER_IDLE_MS ?? 600_000);
const port = Number(process.env.PORT ?? 8080);
const HEARTBEAT_MS = 20_000;
const CANCEL_CHECK_MS = 3_000;
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Worker concurrency must be 1–4.');
if (!Number.isFinite(idleMs) || idleMs < 1000 || idleMs > 3_600_000) throw new Error('Idle timeout must be 1 second to 60 minutes.');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid health port.');

const shutdown = new AbortController();
const client = new ConvexHttpClient(convexUrl, { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(25_000), ...(init?.signal ? [init.signal] : [])]) }) });
const subscriptions = new ConvexClient(convexUrl);
let revision = 0, ready = false, activeTasks = 0, draining = false, lastWorkAt = Date.now();
const waiters = new Set<() => void>();
const wake = () => { for (const resolve of waiters) resolve(); };
const unsubscribe = subscriptions.onUpdate(api.mediaTasks.ready, { workerSecret,processorVersion:MEDIA_PROCESSOR_VERSION,...lane }, value => {
  revision++; ready = !!value;
  if (ready) { lastWorkAt = Date.now(); wake(); }
});
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ healthy: true, activeTasks, draining, processorVersion:MEDIA_PROCESSOR_VERSION })); return;
  }
  if (request.method === 'POST' && request.url === '/drain') {
    const actual = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${workerSecret}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { response.writeHead(401).end(); return; }
    draining = true; wake();
    response.writeHead(202).end(); return;
  }
  response.writeHead(404).end();
});

function waitForWork(observed: number) {
  if (shutdown.signal.aborted || draining || (revision !== observed && ready)) return Promise.resolve();
  return new Promise<void>(resolve => {
    const done = () => { waiters.delete(done); shutdown.signal.removeEventListener('abort', done); resolve(); };
    waiters.add(done); shutdown.signal.addEventListener('abort', done, { once: true });
  });
}
function pause() {
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); shutdown.signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, 5000);
    shutdown.signal.addEventListener('abort', done, { once: true });
  });
}
async function runSlot() {
  while (!shutdown.signal.aborted && !draining) {
    try {
      const observed = revision;
      const claimedAt = Date.now();
      const task = await client.mutation(api.mediaTasks.claim, { workerSecret: workerSecret!, compact:true,processorVersion:MEDIA_PROCESSOR_VERSION,...lane });
      if (!task) { await waitForWork(observed); continue; }
      activeTasks++; lastWorkAt = Date.now();
      const controller = new AbortController();
      const startedAt=Date.now(),deadline=AbortSignal.timeout(15 * 60_000);
      const signal = AbortSignal.any([controller.signal, shutdown.signal, deadline]);
      const credentials = { taskId: task.taskId, leaseToken: task.leaseToken };
      let progress = 0, reported = -1,activity:MediaTaskActivity|undefined, heartbeats = Promise.resolve(), renewedAt = claimedAt;
      // A transient transport failure retries on the next tick. Stop when Convex
      // says the lease ended, or once two renewals were missed: renewedAt is when
      // the last successful request was sent, so the lease then has under one
      // interval left and Convex cannot yet have re-queued the task.
      const heartbeat = () => {
        if (Date.now() - renewedAt >= MEDIA_TASK_LEASE_MS - HEARTBEAT_MS) { controller.abort(); return; }
        heartbeats = heartbeats.then(async () => {
          if (signal.aborted) return;
          const next = progress, sentAt = Date.now();
          await client.mutation(api.mediaTasks.heartbeat, { ...credentials, progress: next,...(activity?{activity}:{}) }); reported = next; renewedAt = sentAt;
        }).catch(error => { if (isMediaLeaseLost(error)) controller.abort(); });
      };
      const timer = setInterval(heartbeat, HEARTBEAT_MS);
      // Stop and cancellation end the lease in Convex; check every few seconds
      // instead of learning it at the next 20-second heartbeat.
      const cancelled = setInterval(() => {
        if (signal.aborted) return;
        void client.query(api.mediaTasks.leaseActive, credentials).then(active => { if (!active) controller.abort(); }).catch(() => {});
      }, CANCEL_CHECK_MS);
      console.log(JSON.stringify({ event: 'media-started', timestamp:new Date().toISOString(),projectId:task.projectId, kind: task.kind, taskId: task.taskId }));
      try {
        const snapshot=await client.query(api.mediaTasks.work,credentials);
        signal.throwIfAborted();
        const result = await processMediaTask(snapshot, client, convexUrl!, signal, percent => {
          progress = Math.max(progress, Math.min(99, percent));
          if (progress - reported >= 10) heartbeat();
        },next=>{if(activity!==next){activity=next;heartbeat();}});
        clearInterval(timer); clearInterval(cancelled); await heartbeats; signal.throwIfAborted();
        await client.mutation(api.mediaTasks.complete, { ...credentials, result });
        console.log(JSON.stringify({ event: 'media-completed', timestamp:new Date().toISOString(),projectId:task.projectId,runId:snapshot.aiRunId, taskId: task.taskId }));
      } catch (error) {
        clearInterval(timer); clearInterval(cancelled); await heartbeats;
        const timedOut=deadline.aborted;
        const retryable=task.kind!=='review'&&!(task.kind==='render'&&timedOut)&&isRetryableAnalysisError(error);
        if (!shutdown.signal.aborted && !controller.signal.aborted) {
          await client.mutation(api.mediaTasks.fail, { ...credentials, retryable, error: timedOut&&task.kind==='render'?'The export exceeded its 15-minute processing limit. Automatic retries were stopped.':error instanceof Error ? error.message.slice(0, 1000) : 'Media processing failed.' }).catch(() => {});
        }
        console.log(JSON.stringify({ event: 'media-interrupted', timestamp:new Date().toISOString(),projectId:task.projectId, taskId: task.taskId,kind:task.kind,elapsedMs:Date.now()-startedAt,progress,reason:shutdown.signal.aborted?'shutdown':controller.signal.aborted?'lease-ended':timedOut?'timeout':'processing-error',retryable }));
      } finally { activeTasks--; lastWorkAt = Date.now(); }
    } catch {
      if (!shutdown.signal.aborted && !draining) { ready = false; console.error(JSON.stringify({ event: 'queue-reconnecting' })); await pause(); }
    }
  }
}
process.on('SIGINT', () => shutdown.abort());
process.on('SIGTERM', () => shutdown.abort());
const idleTimer = setInterval(() => {
  if (activeTasks === 0 && (draining || (!ready && Date.now() - lastWorkAt >= idleMs))) shutdown.abort();
}, Math.min(10_000, idleMs));

async function main() {
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
    console.log(JSON.stringify({ event: 'media-ready', slots: concurrency }));
    await Promise.all(Array.from({ length: concurrency }, runSlot));
  } finally {
    clearInterval(idleTimer); unsubscribe();
    // The SDK can await a WebSocket handshake indefinitely while closing.
    // Task slots have settled here, so bound transport cleanup before exiting.
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([subscriptions.close(), new Promise<void>(resolve => { closeTimer = setTimeout(resolve, 5000); })]);
    } finally { clearTimeout(closeTimer); }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
void main().then(() => process.exit(0)).catch(() => { shutdown.abort(); console.error(JSON.stringify({ event: 'media-stopped' })); process.exit(1); });
