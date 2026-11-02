import type { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import { processMediaTask } from './media-task-runner';
import { isMediaLeaseLost, isRetryableAnalysisError, MEDIA_TASK_LEASE_MS } from '../media-analysis/errors';
import type { MediaTaskActivity } from '../media-analysis/activity';
import { MEDIA_PROCESSOR_VERSION } from '../media-analysis/processor-version';

const HEARTBEAT_MS = 20_000;
const CANCEL_CHECK_MS = 3_000;
const RECONNECT_MS = 5_000;

export type MediaWorkerEvent = 'media-started' | 'media-completed' | 'media-interrupted' | 'queue-reconnecting';
export type MediaWorkerOptions = {
  client: ConvexHttpClient;
  subscriptions: ConvexClient;
  convexUrl: string;
  workerSecret: string;
  slots: number;
  /** Which tasks this worker claims: an export lane, or Fly's exports only. */
  claim: { lane?: 'ultra' | 'any'; rendersOnly?: boolean; processorBackend?: 'fly' | 'cloudflare' | 'local' };
  deadlineMs: number;
  signal: AbortSignal;
  /** A draining worker finishes its current tasks and claims no more. */
  draining?: () => boolean;
  log: (event: MediaWorkerEvent, fields: Record<string, unknown>) => void;
};
export type MediaWorkerState = { activeTasks: number; lastWorkAt: number; ready: boolean };

/** The claim → heartbeat → complete loop shared by the local dev worker and the production
 *  processor and export containers. Convex owns retries: a slot that loses its lease stops. */
export function startMediaWorker(options: MediaWorkerOptions) {
  const { client, workerSecret, signal: shutdown } = options;
  const state: MediaWorkerState = { activeTasks: 0, lastWorkAt: Date.now(), ready: false };
  const draining = () => options.draining?.() ?? false;
  const claimArgs = { workerSecret, processorVersion: MEDIA_PROCESSOR_VERSION, ...options.claim };
  const deadlineMinutes = Math.round(options.deadlineMs / 60_000);
  let revision = 0;
  const waiters = new Set<() => void>();
  const wake = () => { for (const resolve of waiters) resolve(); };
  const unsubscribe = options.subscriptions.onUpdate(api.mediaTasks.ready, claimArgs, value => {
    revision++; state.ready = !!value;
    if (state.ready) { state.lastWorkAt = Date.now(); wake(); }
  });

  function waitForWork(observed: number) {
    if (shutdown.aborted || draining() || (revision !== observed && state.ready)) return Promise.resolve();
    return new Promise<void>(resolve => {
      const done = () => { waiters.delete(done); shutdown.removeEventListener('abort', done); resolve(); };
      waiters.add(done); shutdown.addEventListener('abort', done, { once: true });
    });
  }
  function pause() {
    return new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); shutdown.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, RECONNECT_MS);
      shutdown.addEventListener('abort', done, { once: true });
    });
  }

  async function runSlot() {
    while (!shutdown.aborted && !draining()) {
      try {
        const observed = revision, claimedAt = Date.now();
        const task = await client.mutation(api.mediaTasks.claim, { ...claimArgs, compact: true });
        if (!task) { await waitForWork(observed); continue; }
        state.activeTasks++; state.lastWorkAt = Date.now();
        const controller = new AbortController();
        const startedAt = Date.now(), deadline = AbortSignal.timeout(options.deadlineMs);
        let signal = AbortSignal.any([controller.signal, shutdown, deadline]);
        const credentials = { taskId: task.taskId, leaseToken: task.leaseToken };
        let progress = 0, reported = -1, activity: MediaTaskActivity | undefined, heartbeats = Promise.resolve(), renewedAt = claimedAt, queued = false, writing = 0;
        // A transient transport failure retries on the next tick. Stop when Convex
        // says the lease ended, or once two renewals were missed: renewedAt is when
        // the last successful request was sent, so the lease then has under one
        // interval left and Convex cannot yet have re-queued the task.
        // One renewal waits at most: it sends the latest progress when it runs, so a
        // stalled request cannot release a burst of renewals onto the task row.
        const heartbeat = () => {
          if (!writing && Date.now() - renewedAt >= MEDIA_TASK_LEASE_MS - HEARTBEAT_MS) { controller.abort(); return; }
          if (queued) return;
          queued = true;
          heartbeats = heartbeats.then(async () => {
            queued = false;
            if (signal.aborted) return;
            const next = progress, sentAt = Date.now();
            await client.mutation(api.mediaTasks.heartbeat, { ...credentials, progress: next, ...(activity ? { activity } : {}) });
            reported = next; renewedAt = sentAt;
          }).catch(error => { if (isMediaLeaseLost(error)) controller.abort(); });
        };
        // Starting and finishing an upload write the task row too. They take their turn
        // between renewals instead of racing them: a renewal committing mid-mutation made
        // finishing an upload conflict on every retry. Convex still expires the lease if
        // one runs too long, so missed renewals do not stop the task meanwhile.
        const exclusive = <T,>(run: () => Promise<T>): Promise<T> => {
          const result = heartbeats.then(async () => { writing++; try { return await run(); } finally { writing--; } });
          heartbeats = result.then(() => {}, () => {});
          return result;
        };
        const timer = setInterval(heartbeat, HEARTBEAT_MS);
        // Stop and cancellation end the lease in Convex; check every few seconds
        // instead of learning it at the next 20-second heartbeat.
        const cancelled = setInterval(() => {
          if (signal.aborted) return;
          void client.query(api.mediaTasks.leaseActive, credentials).then(active => { if (!active) controller.abort(); }).catch(() => {});
        }, CANCEL_CHECK_MS);
        options.log('media-started', { projectId: task.projectId, kind: task.kind, taskId: task.taskId });
        try {
          const snapshot = await client.query(api.mediaTasks.work, credentials);
          if (snapshot.derive?.op === 'pixelTrack') signal = AbortSignal.any([controller.signal, shutdown]);
          signal.throwIfAborted();
          const result = await processMediaTask(snapshot, client, options.convexUrl, signal, percent => {
            progress = Math.max(progress, Math.min(99, percent));
            if (progress - reported >= 10) heartbeat();
          }, next => { if (activity !== next) { activity = next; heartbeat(); } }, exclusive);
          clearInterval(timer); clearInterval(cancelled); await heartbeats; signal.throwIfAborted();
          await client.mutation(api.mediaTasks.complete, { ...credentials, result });
          options.log('media-completed', { projectId: task.projectId, runId: snapshot.aiRunId, taskId: task.taskId, kind: task.kind });
        } catch (error) {
          clearInterval(timer); clearInterval(cancelled); await heartbeats;
          const timedOut = signal.aborted && deadline.aborted;
          const retryable = task.kind !== 'review' && !(task.kind === 'render' && timedOut) && isRetryableAnalysisError(error);
          if (!shutdown.aborted && !controller.signal.aborted) {
            await client.mutation(api.mediaTasks.fail, { ...credentials, retryable, error: timedOut && task.kind === 'render' ? `The export exceeded its ${deadlineMinutes}-minute processing limit. Automatic retries were stopped.` : error instanceof Error ? error.message.slice(0, 1000) : 'Media processing failed.' }).catch(() => {});
          }
          options.log('media-interrupted', { projectId: task.projectId, taskId: task.taskId, kind: task.kind, elapsedMs: Date.now() - startedAt, progress, reason: shutdown.aborted ? 'shutdown' : controller.signal.aborted ? 'lease-ended' : timedOut ? 'timeout' : 'processing-error', retryable });
        } finally { state.activeTasks--; state.lastWorkAt = Date.now(); }
      } catch {
        if (!shutdown.aborted && !draining()) { state.ready = false; options.log('queue-reconnecting', {}); await pause(); }
      }
    }
  }

  const done = Promise.all(Array.from({ length: options.slots }, runSlot)).then(() => {}).finally(unsubscribe);
  return { state, wake, done };
}
