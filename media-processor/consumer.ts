import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { startMediaWorker, type MediaWorkerOptions } from '../lib/server/media-worker-loop';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { videoImporter } from '../lib/server/import-video-link';
import { api } from '../convex/_generated/api';

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const workerSecret = process.env.RENDER_WORKER_SECRET;
if (!convexUrl || !workerSecret) throw new Error('Configure the production Convex URL and media worker secret.');
const concurrency = Number(process.env.MEDIA_WORKER_CONCURRENCY ?? 1);
// The Ultra slot claims only Ultra exports; regular slots leave them to it.
const backend = process.env.MEDIA_PROCESSOR_BACKEND;
const lane: MediaWorkerOptions['claim'] = { ...(backend === 'railway' ? { processorBackend: backend, lane: 'any' } : {}), ...(process.env.MEDIA_LANE === 'ultra' ? { lane: 'ultra' } : {}),
  // Dedicated export workers claim only exports of their lane.
  ...(process.env.MEDIA_RENDERS_ONLY === 'true' ? { rendersOnly: true, ...(process.env.RAILWAY_SERVICE_ID ? { renderProvider: 'railway' } : {}) } : {}) };
// Staying warm after work spares the next export a container and Chromium cold
// start; idle containers still bill memory/disk, so this stays bounded.
const idleMs = Number(process.env.MEDIA_WORKER_IDLE_MS ?? 600_000);
const port = Number(process.env.PORT ?? 8080);
// Long 4K60 exports on large export machines legitimately need more than 15 minutes.
const deadlineMs = Number(process.env.MEDIA_TASK_DEADLINE_MS ?? 15 * 60_000);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Worker concurrency must be 1–4.');
if (!Number.isFinite(idleMs) || idleMs < 1000 || idleMs > 3_600_000) throw new Error('Idle timeout must be 1 second to 60 minutes.');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid health port.');
if (!Number.isFinite(deadlineMs) || deadlineMs < 60_000 || deadlineMs > 2 * 3600_000) throw new Error('Task deadline must be 1 minute to 2 hours.');

const shutdown = new AbortController();
const client = new ConvexHttpClient(convexUrl, { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(25_000), ...(init?.signal ? [init.signal] : [])]) }) });
if (process.env.RAILWAY_SERVICE_ID) {
  const contract = await client.query(api.railwayWorkers.contract, { workerSecret });
  if (contract.processorVersion > MEDIA_PROCESSOR_VERSION) throw new Error('Railway image is older than the queue contract.');
  console.log(JSON.stringify({ event: 'railway-queue-verified', processorVersion: MEDIA_PROCESSOR_VERSION }));
}
const subscriptions = new ConvexClient(convexUrl);
let draining = false;
const worker = startMediaWorker({
  client, subscriptions, convexUrl, workerSecret, slots: concurrency, claim: lane, deadlineMs, signal: shutdown.signal,
  draining: () => draining,
  log: (event, fields) => (event === 'queue-reconnecting' ? console.error : console.log)(JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields })),
});
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ healthy: true, activeTasks: worker.state.activeTasks, draining, processorVersion:MEDIA_PROCESSOR_VERSION })); return;
  }
  if (request.method === 'POST' && request.url === '/drain') {
    const actual = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${workerSecret}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { response.writeHead(401).end(); return; }
    draining = true; worker.wake();
    response.writeHead(202).end(); return;
  }
  response.writeHead(404).end();
});

process.on('SIGINT', () => shutdown.abort());
process.on('SIGTERM', () => {
  if (process.env.RAILWAY_SERVICE_ID) { draining = true; worker.wake(); }
  else shutdown.abort();
});
const idleTimer = setInterval(() => {
  const { activeTasks, ready, lastWorkAt } = worker.state;
  if (activeTasks === 0 && (draining || (!ready && Date.now() - lastWorkAt >= idleMs))) shutdown.abort();
}, Math.min(10_000, idleMs));

async function main() {
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
    console.log(JSON.stringify({ event: 'media-ready', slots: concurrency }));
    // Link imports depend on a current yt-dlp; show which one this worker runs.
    if (process.env.YT_DLP_PATH && process.env.MEDIA_RENDERS_ONLY !== 'true') void videoImporter().then(({ version, pythonPath }) => console.log(JSON.stringify({ event: 'video-importer-ready', ytDlp: version, source: pythonPath ? 'updated' : 'image' })));
    await worker.done;
  } finally {
    clearInterval(idleTimer);
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
