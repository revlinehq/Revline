import { ConvexClient } from 'convex/browser';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { api } from '../../convex/_generated/api';
import { alive, config, incidentSchema, openPR, readJob, root, state, writeJob, type Endpoint, type Job } from './shared';

await mkdir(join(state, 'jobs'), { recursive: true, mode: 0o700 });
const lock = join(state, 'listener.pid');
try { const previous = Number(await readFile(lock, 'utf8')); if (alive(previous)) process.exit(0); } catch { /* First install. */ }
await writeFile(lock, String(process.pid), { mode: 0o600, flag: 'w' });
const settings = await config();
const clients = settings.endpoints.map(endpoint => ({ endpoint, client: new ConvexClient(endpoint.url) }));
const pending = new Map<string, { endpoint: Endpoint; incident: Job['incident'] }>();
let draining = false;
let dirty = false;
function wake() { dirty = true; if (!draining) void drain(); }
async function activeJobs() {
  let active = 0;
  for (const name of await readdir(join(state, 'jobs'))) {
    if (!name.endsWith('.json')) continue;
    const path = join(state, 'jobs', name);
    const job = await readJob(path);
    if (job.phase !== 'starting' && job.phase !== 'running') continue;
    if (alive(job.workerPid) || alive(job.codexPid)) active++;
    else {
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
      for (const [key, { endpoint, incident }] of queue) {
        if (active >= 2) break;
        const connection = clients.find(item => item.endpoint === endpoint);
        if (!connection) continue;
        const client = connection.client;
        const claimToken = crypto.randomUUID();
        const args = { secret: endpoint.secret, id: incidentId(incident._id), generation: incident.generation, claimToken };
        // GitHub failure leaves the item pending, instead of risking a duplicate PR.
        const existing = await openPR(incident.fingerprint);
        if (!await client.mutation(api.incidents.claim, args)) { pending.delete(key); continue; }
        pending.delete(key);
        if (existing) {
          await client.mutation(api.incidents.recordPR, { ...args, prUrl: existing.url });
          console.info(`[incidents] ${incident.fingerprint} already has ${existing.url}`);
          continue;
        }
        const slug = `${incident.deployment}-${incident.fingerprint.slice(-12)}-${incident.generation}`;
        const path = join(state, 'jobs', `${slug}.json`);
        const job: Job = { incident, claimToken, branch: `incident/${slug}`, directory: join(homedir(), 'Developer', `revline-incident-${slug}`), phase: 'starting', workerPid: process.pid };
        await writeJob(path, job);
        const log = await open(join(state, `${slug}.log`), 'a', 0o600);
        const worker = spawn(process.execPath, ['--import', 'tsx', join(root, 'scripts/incident-listener/worker.ts'), path], { cwd: root, stdio: ['ignore', log.fd, log.fd], detached: true });
        await new Promise<void>((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject); });
        worker.unref();
        await log.close();
        active++;
        console.info(`[incidents] Starting Sol for ${incident.deployment}/${incident.fingerprint} in ${job.directory}`);
      }
    } while (dirty);
  } catch (error) {
    console.error(`[incidents] Queue paused after ${error instanceof Error ? error.name : 'an error'}; next subscription or job event will resume it.`);
  } finally { draining = false; }
}
watch(join(state, 'jobs'), (_event, name) => { if (name?.endsWith('.json')) wake(); });
for (const { endpoint, client } of clients) {
  client.onUpdate(api.incidents.undelivered, { secret: endpoint.secret }, rows => {
    for (const [key, item] of pending) if (item.endpoint === endpoint) pending.delete(key);
    for (const row of rows) {
      const incident = incidentSchema.parse(row);
      if (incident.deployment !== endpoint.deployment) throw new Error('Incident deployment mismatch');
      pending.set(`${endpoint.deployment}:${incident._id}`, { endpoint, incident });
    }
    wake();
  }, () => console.error(`[incidents] ${endpoint.deployment} subscription unavailable; waiting for deployment/configuration.`));
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void Promise.all(clients.map(({ client }) => client.close())).finally(async () => { await rm(lock, { force: true }); process.exit(0); }); });
console.info('[incidents] Listening to dev and prod with outbound Convex subscriptions; concurrency 2.');
wake();
