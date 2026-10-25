import { ConvexHttpClient, ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import { processMediaTask } from '../lib/server/media-task-runner';
import { isMediaLeaseLost, isRetryableAnalysisError, MEDIA_TASK_LEASE_MS } from '../lib/media-analysis/errors';
import type { MediaTaskActivity } from '../lib/media-analysis/activity';

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const workerSecret = process.env.RENDER_WORKER_SECRET;
if (!convexUrl || !workerSecret) throw new Error('Set NEXT_PUBLIC_CONVEX_URL and RENDER_WORKER_SECRET for the media worker.');
const client = new ConvexHttpClient(convexUrl);
const subscriptions = new ConvexClient(convexUrl);
let queueRevision = 0, queueReady = false;
const queueWaiters = new Set<() => void>();
const unsubscribe = subscriptions.onUpdate(api.mediaTasks.ready, { workerSecret,processorVersion:5,lane:'any' }, ready => {
  queueRevision++; queueReady = !!ready;
  if (queueReady) for (const wake of queueWaiters) wake();
});
const HEARTBEAT_MS = 20_000;
const CANCEL_CHECK_MS = 3_000;
const shutdown = new AbortController();
process.on('SIGINT', () => shutdown.abort());
process.on('SIGTERM', () => shutdown.abort());

async function runSlot() {
  while (!shutdown.signal.aborted) {
    try {
      const observedRevision = queueRevision;
      const claimedAt = Date.now();
      const task = await client.mutation(api.mediaTasks.claim, { workerSecret: workerSecret!, compact:true,processorVersion:5,lane:'any' });
      if (!task) { await waitForWork(observedRevision); continue; }
      console.log(`[${new Date().toISOString()}] Chat ${task.projectId} · media task ${task.taskId}: ${task.kind} started.`);
      const controller = new AbortController();
      const deadline=AbortSignal.timeout(15 * 60_000);
      const signal = AbortSignal.any([controller.signal, shutdown.signal, deadline]);
      const credentials = { taskId: task.taskId, leaseToken: task.leaseToken };
      let progress = 0, reported = -1,activity:MediaTaskActivity|undefined;
      let heartbeats = Promise.resolve(), renewedAt = claimedAt;
      // A transient transport failure retries on the next tick. Stop when Convex
      // says the lease ended, or once two renewals were missed: renewedAt is when
      // the last successful request was sent, so the lease then has under one
      // interval left and Convex cannot yet have re-queued the task.
      const heartbeat = () => {
        if (Date.now() - renewedAt >= MEDIA_TASK_LEASE_MS - HEARTBEAT_MS) { controller.abort(); return; }
        heartbeats = heartbeats.then(async () => {
          if (signal.aborted) return;
          const next = progress, sentAt = Date.now();
          await client.mutation(api.mediaTasks.heartbeat, { ...credentials, progress: next,...(activity?{activity}:{}) });
          reported = next; renewedAt = sentAt;
        }).catch(error => { if (isMediaLeaseLost(error)) controller.abort(); });
      };
      const timer = setInterval(heartbeat, HEARTBEAT_MS);
      // Stop and cancellation end the lease in Convex; check every few seconds
      // instead of learning it at the next 20-second heartbeat.
      const cancelled = setInterval(() => {
        if (signal.aborted) return;
        void client.query(api.mediaTasks.leaseActive, credentials).then(active => { if (!active) controller.abort(); }).catch(() => {});
      }, CANCEL_CHECK_MS);
      try {
        const snapshot=await client.query(api.mediaTasks.work,credentials);
        signal.throwIfAborted();
        const result = await processMediaTask(snapshot, client, convexUrl!, signal, percent => {
          progress = Math.max(progress, Math.min(99, percent));
          if (progress - reported >= 10) heartbeat();
        },next=>{if(activity!==next){activity=next;heartbeat();}});
        clearInterval(timer); clearInterval(cancelled); await heartbeats; signal.throwIfAborted();
        await client.mutation(api.mediaTasks.complete, { ...credentials, result });
        console.log(`[${new Date().toISOString()}] Chat ${task.projectId} · media task ${task.taskId}: completed.`);
      } catch (error) {
        clearInterval(timer); clearInterval(cancelled); await heartbeats;
        if (!shutdown.signal.aborted && !controller.signal.aborted) {
          const retryable = task.kind!=='review'&&!(task.kind==='render'&&deadline.aborted)&&isRetryableAnalysisError(error);
          await client.mutation(api.mediaTasks.fail, { ...credentials, error: deadline.aborted&&task.kind==='render'?'The export exceeded its 15-minute processing limit. Automatic retries were stopped.':error instanceof Error ? error.message.slice(0, 1000) : 'Media processing failed.', retryable }).catch(() => {});
        }
        console.log(`[${new Date().toISOString()}] Chat ${task.projectId} · media task ${task.taskId}: interrupted or failed; Convex owns recovery.`);
      }
    } catch {
      if (!shutdown.signal.aborted) { console.error('Media queue connection interrupted. Retrying.'); await pause(5000); }
    }
  }
}
function pause(ms: number) {
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); shutdown.signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    shutdown.signal.addEventListener('abort', done, { once: true });
  });
}
const slots = Number(process.env.MEDIA_WORKER_CONCURRENCY ?? 2);
function waitForWork(observedRevision: number) {
  if (shutdown.signal.aborted || (queueRevision !== observedRevision && queueReady)) return Promise.resolve();
  return new Promise<void>(resolve => {
    const wake = () => { queueWaiters.delete(wake); shutdown.signal.removeEventListener('abort', wake); resolve(); };
    queueWaiters.add(wake); shutdown.signal.addEventListener('abort', wake, { once: true });
  });
}
if (!Number.isInteger(slots) || slots < 1 || slots > 4) throw new Error('MEDIA_WORKER_CONCURRENCY must be 1–4.');
console.log(`Revline media worker ready (${slots} slots).`);
void Promise.all(Array.from({ length: slots }, runSlot)).catch(() => { console.error('Media worker stopped unexpectedly.'); process.exitCode = 1; }).finally(async () => { unsubscribe(); await subscriptions.close(); });
