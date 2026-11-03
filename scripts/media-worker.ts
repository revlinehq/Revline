import { ConvexHttpClient, ConvexClient } from 'convex/browser';
import { startMediaWorker } from '../lib/server/media-worker-loop';

// Local development worker: the shared media loop with readable log lines.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const workerSecret = process.env.RENDER_WORKER_SECRET;
if (!convexUrl || !workerSecret) throw new Error('Set NEXT_PUBLIC_CONVEX_URL and RENDER_WORKER_SECRET for the media worker.');
const slots = Number(process.env.MEDIA_WORKER_CONCURRENCY ?? 2);
if (!Number.isInteger(slots) || slots < 1 || slots > 4) throw new Error('MEDIA_WORKER_CONCURRENCY must be 1–4.');

const shutdown = new AbortController();
process.on('SIGINT', () => shutdown.abort());
process.on('SIGTERM', () => shutdown.abort());
const subscriptions = new ConvexClient(convexUrl);
const label = (fields: Record<string, unknown>) => `[${new Date().toISOString()}] Chat ${fields.projectId} · media task ${fields.taskId}`;
const worker = startMediaWorker({
  client: new ConvexHttpClient(convexUrl), subscriptions, convexUrl, workerSecret, slots, claim: { lane: 'any' },
  deadlineMs: 15 * 60_000, signal: shutdown.signal,
  // Read-only sessions can keep both development services up without claiming paid work.
  draining: () => process.env.MEDIA_WORKER_PAUSED === 'true',
  log: (event, fields) => {
    if (event === 'media-started') console.log(`${label(fields)}: ${fields.kind} started.`);
    else if (event === 'media-completed') console.log(`${label(fields)}: completed.`);
    else if (event === 'media-interrupted') console.log(`${label(fields)}: interrupted or failed; Convex owns recovery.`);
    else console.error('Media queue connection interrupted. Retrying.');
  },
});
console.log(`Revline media worker ready (${slots} slots${process.env.MEDIA_WORKER_PAUSED === 'true' ? ', paused: no tasks will be claimed' : ''}).`);
const pausedTimer = process.env.MEDIA_WORKER_PAUSED === 'true' ? setInterval(() => {}, 60_000) : undefined;
const lifetime = process.env.MEDIA_WORKER_PAUSED === 'true' ? new Promise<void>(resolve => { if (shutdown.signal.aborted) resolve(); else shutdown.signal.addEventListener('abort', () => resolve(), { once: true }); }) : worker.done;
void lifetime.catch(() => { console.error('Media worker stopped unexpectedly.'); process.exitCode = 1; }).finally(() => { clearInterval(pausedTimer); return subscriptions.close(); });
