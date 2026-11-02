import { ConvexClient } from 'convex/browser';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { parseArgs } from 'node:util';
import { incidentNonDefectReason, incidentText } from '../../lib/incidents';
import { api } from '../../convex/_generated/api';
import { alive, config, incidentSchema, openPRs, readJob, root, run, state, writeJob, type Endpoint, type Job } from './shared';

// A manual investigation can drain just one incident without consuming the backlog.
const { values: { incident: onlyIncident } } = parseArgs({ options: { incident: { type: 'string' } } });
await mkdir(join(state, 'jobs'), { recursive: true, mode: 0o700 });
const lock = join(state, 'listener.pid');
// Linux abstract sockets are atomic and disappear even after SIGKILL or reboot.
// Keep the existing launchd lock for the optional Mac installation.
const linuxLock = process.platform === 'linux' ? createServer(socket => socket.destroy()) : null;
if (linuxLock) {
  try { await new Promise<void>((resolve, reject) => { linuxLock.once('error', reject); linuxLock.listen(`\0revline-incidents-${process.getuid?.()}`, resolve); }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') process.exit(0); throw error; }
} else {
  try { await run('/usr/bin/shlock', ['-p', String(process.pid), '-f', lock]); } catch { process.exit(0); }
}
const settings = await config();
const clients = settings.endpoints.map(endpoint => ({ endpoint, client: new ConvexClient(endpoint.url) }));
const pending = new Map<string, { endpoint: Endpoint; incident: Job['incident'] }>();
let draining = false;
let dirty = false;
function wake() { dirty = true; if (!draining) void drain(); }
async function startWorker(path: string, job: Job) {
  const log = await open(join(state, `${job.branch.replaceAll('/', '-')}.log`), 'a', 0o600);
  try {
    const worker = spawn(process.execPath, ['--import', 'tsx', join(root, 'scripts/incident-listener/worker.ts'), path], { cwd: root, stdio: ['ignore', log.fd, log.fd, 'ipc'], detached: true });
    await new Promise<void>((resolve, reject) => {
      worker.once('message', () => resolve());
      worker.once('error', reject);
      worker.once('exit', () => reject(new Error('Worker exited before its launch handshake')));
    });
    // A worker cannot send the first Sol message until its PID is durable.
    await writeJob(path, { ...job, workerPid: worker.pid });
    worker.send('start');
    worker.once('exit', wake);
    worker.unref();
  } finally { await log.close(); }
}
async function activeJobs() {
  let active = 0;
  for (const name of await readdir(join(state, 'jobs'))) {
    if (!name.endsWith('.json')) continue;
    const path = join(state, 'jobs', name);
    const job = await readJob(path);
    if (job.phase !== 'starting' && job.phase !== 'running') continue;
    if (alive(job.workerPid) || alive(job.codexPid)) active++;
    else if (job.threadId) {
      // T3 owns the session, so a missing monitor PID does not mean Sol stopped.
      await startWorker(path, job);
      active++;
    } else {
      // A process lost between claim and launch is never launched a second time automatically.
      const endpoint = settings.endpoints.find(item => item.deployment === job.incident.deployment);
      const connection = clients.find(item => item.endpoint === endpoint);
      if (connection) await connection.client.mutation(api.incidents.failed, { secret: connection.endpoint.secret, id: incidentId(job.incident._id), generation: job.incident.generation, claimToken: job.claimToken, message: 'Listener or worker stopped; inspect the local job and explicitly retry.' });
      await writeJob(path, { ...job, phase: 'failed' });
    }
  }
  return active;
}
// IDs are received from this deployment's validated incident query and persisted locally.
import type { Id } from '../../convex/_generated/dataModel';
function incidentId(value: string): Id<'incidents'> { return value as Id<'incidents'>; }
async function drain() {
  draining = true;
  try {
    do {
      dirty = false;
      let active = await activeJobs();
      const queue = [...pending.entries()].sort(([, a], [, b]) => b.incident.priority - a.incident.priority || a.incident.firstSeen - b.incident.firstSeen);
      const prs = queue.length ? await openPRs() : [];
      for (const [key, { endpoint, incident }] of queue) {
        const existing = prs.find(pr => pr.body.includes(incident.fingerprint));
        const nonDefect = incidentNonDefectReason(incident.message, incident.kind, incident.samples.map(sample => sample.context));
        if (active >= 2 && !existing && !nonDefect) continue;
        const connection = clients.find(item => item.endpoint === endpoint);
        if (!connection) continue;
        const client = connection.client;
        const claimToken = crypto.randomUUID();
        const args = { secret: endpoint.secret, id: incidentId(incident._id), generation: incident.generation, claimToken };
        // GitHub failure leaves the item pending, instead of risking a duplicate PR.
        const slug = `${incident.deployment}-${incident.fingerprint.slice(-12)}-${incident.generation}-${claimToken.slice(0, 8)}`;
        const path = join(state, 'jobs', `${slug}.json`);
        const job: Job = { incident, claimToken, branch: `incident/${slug}`, phase: 'starting', workerPid: process.pid };
        try {
          // Persist before claiming so a crash cannot leave an untraceable delivery claim.
          await writeJob(path, job);
          if (!await client.mutation(api.incidents.claim, args)) {
            pending.delete(key);
            await writeJob(path, { ...job, phase: 'finished' });
            continue;
          }
          pending.delete(key);
          if (nonDefect) {
            await client.mutation(api.incidents.failed, { ...args, message: `Not a product defect: ${nonDefect}. No Sol launched.` });
            await writeJob(path, { ...job, phase: 'finished' });
            console.info(`[incidents] Skipped ${incident.fingerprint}: ${nonDefect}.`);
            continue;
          }
          if (existing) {
            await client.mutation(api.incidents.recordPR, { ...args, prUrl: existing.url });
            await writeJob(path, { ...job, phase: 'finished', prUrl: existing.url });
            console.info(`[incidents] ${incident.fingerprint} already has ${existing.url}`);
            continue;
          }
          await startWorker(path, job);
          active++;
          console.info(`[incidents] Starting T3 Sol for ${incident.deployment}/${incident.fingerprint} on ${job.branch}`);
        } catch {
          await client.mutation(api.incidents.failed, { ...args, message: 'Local worker could not start; inspect the private job log.' });
          await writeJob(path, { ...job, phase: 'failed' });
        }
      }
    } while (dirty);
  } catch (error) {
    console.error(`[incidents] Queue paused after ${error instanceof Error ? incidentText(error.message, 500) : 'an error'}; next subscription or job event will resume it.`);
  } finally { draining = false; }
}
watch(join(state, 'jobs'), (_event, name) => { if (name?.endsWith('.json')) wake(); });
for (const { endpoint, client } of clients) {
  let connected = false;
  client.onUpdate(api.incidents.undelivered, { secret: endpoint.secret }, rows => {
    if (!connected) console.info(`[incidents] ${endpoint.deployment} subscription ready.`);
    connected = true;
    for (const [key, item] of pending) if (item.endpoint === endpoint) pending.delete(key);
    for (const row of rows) {
      const incident = incidentSchema.parse(row);
      if (incident.deployment !== endpoint.deployment) throw new Error('Incident deployment mismatch');
      if (onlyIncident && incident._id !== onlyIncident) continue;
      pending.set(`${endpoint.deployment}:${incident._id}`, { endpoint, incident });
    }
    wake();
  }, () => { connected = false; console.error(`[incidents] ${endpoint.deployment} subscription unavailable; waiting for deployment/configuration.`); });
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void Promise.all(clients.map(({ client }) => client.close())).finally(async () => { await rm(lock, { force: true }); process.exit(0); }); });
console.info(`[incidents] Listening to ${settings.endpoints.map(endpoint => endpoint.deployment).join(', ')} with outbound Convex subscriptions; T3 MCP concurrency 2.`);
wake();
