import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { z } from 'zod';
import { railway, railwayConfig, railwayDeploymentRuns, railwayInstance, railwayLogEvents, verifyRailwayTarget } from '../lib/railway-workers.mjs';

const receiptSchema = z.object({
  id: z.string().optional(), config: z.unknown(), projectId: z.string(), processorTaskId: z.string(), exportTaskId: z.string(), ultraTaskId: z.string(), distributedTaskId: z.string().optional(),
  deployments: z.array(z.object({ role: z.enum(['processor', 'export', 'ultra', 'distributed']), serviceId: z.string().uuid(), deploymentId: z.string().uuid(), taskId: z.string() })).min(3).max(4),
});

// Promotions this checkout verified against live staging, and which of them production then ran. Staging moves on
// with every push to main, so a receipt stops verifying live soon after it was proven; this record lets the same
// commit and digest be staged again: within RECORDED_TTL_MS of its live check (the next kind of the same release, a
// retry), and at any time once production ran it (a restore or rollback). A digest never verified needs live proof.
const LEDGER = '.data/railway/promotion-ledger.json';
const RECORDED_TTL_MS = 24 * 3600_000;
const ledgerSchema = z.array(z.object({
  kind: z.enum(['processor', 'exports']), commit: z.string().regex(/^[a-f0-9]{40}$/), image: z.string(), distributedExports: z.boolean(),
  receiptId: z.string(), verifiedAt: z.string().datetime(), productionStagedAt: z.string().datetime().optional(),
}));
/** An unreadable record counts as empty: it is only ever a shortcut, never a requirement. */
async function readLedger() {
  try { return ledgerSchema.parse(JSON.parse(await readFile(resolve(LEDGER), 'utf8'))); }
  catch (error) { if (error?.code !== 'ENOENT') console.log(`Ignoring unreadable ${LEDGER} (${error instanceof Error ? error.message : error}).`); return []; }
}
/** Atomic replace; drops entries production never ran once they can no longer be used. */
async function writeLedger(entries) {
  const kept = entries.filter(entry => entry.productionStagedAt || Date.now() - Date.parse(entry.verifiedAt) < RECORDED_TTL_MS);
  const path = resolve(LEDGER), temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, JSON.stringify(kept, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}
// Distributed exports change only what an export digest is proven to do; a processor digest is the same either way.
const sameDigest = (entry, config, kind) => entry.kind === kind && entry.commit === config[`${kind}Commit`] && entry.image === config[`${kind}Image`] && (kind === 'processor' || entry.distributedExports === config.distributedExports);

/** Marks `kinds` of the production manifest `config` as run in production, when this checkout verified that commit and
 *  digest against live staging. A founder-bypass stage has no verified entry and is not recorded. */
export async function recordProductionStage({ config, kinds }) {
  const entries = await readLedger();
  const at = new Date().toISOString();
  let marked = 0;
  for (const entry of entries) if (kinds.some(kind => sameDigest(entry, config, kind))) { entry.productionStagedAt = at; marked++; }
  if (marked) console.log(`Recorded in ${LEDGER}: production runs ${kinds.map(kind => `${kind} ${config[`${kind}Commit`].slice(0, 7)}`).join(', ')}.`);
  if (marked) await writeLedger(entries);
  return marked;
}

/** `recorded`: when there is no receipt, or staging no longer verifies it live, accept this checkout's record of an
 *  earlier live verification of the same commit and digest (see LEDGER). A receipt is always checked live first; the
 *  promotion proof itself never uses the record. */
export async function verifyStagingPromotion({ config, receiptFile, stagingEnvFile, kinds = ['processor', 'exports'], recorded = false }) {
  if (!recorded) return verifyLive({ config, receiptFile, stagingEnvFile, kinds });
  const fromLedger = async cause => {
    const entries = await readLedger();
    const found = kinds.map(kind => entries.filter(entry => sameDigest(entry, config, kind))
      .find(entry => entry.productionStagedAt || Date.now() - Date.parse(entry.verifiedAt) < RECORDED_TTL_MS));
    if (!found.every(Boolean)) throw cause;
    for (const entry of found) console.log(`Staging promotion of ${entry.kind} ${entry.commit.slice(0, 7)} ${entry.image} accepted from ${LEDGER} (${cause.message}): receipt ${entry.receiptId} verified live ${entry.verifiedAt}${entry.productionStagedAt ? `, ran in production ${entry.productionStagedAt}` : ''}.`);
    return null;
  };
  if (!receiptFile || !stagingEnvFile) return fromLedger(new Error(`Production requires a staging receipt and a separate staging environment file, unless ${LEDGER} records this exact commit and digest as verified live within ${RECORDED_TTL_MS / 3600_000} h or run in production`));
  try { return await verifyLive({ config, receiptFile, stagingEnvFile, kinds }); }
  catch (error) { return fromLedger(error instanceof Error ? error : new Error(String(error))); }
}

async function verifyLive({ config, receiptFile, stagingEnvFile, kinds }) {
  if (!receiptFile || !stagingEnvFile) throw new Error('Production requires a staging receipt and a separate staging environment file.');
  const receipt = receiptSchema.parse(JSON.parse(await readFile(receiptFile, 'utf8')));
  const staging = railwayConfig(receipt.config);
  if (staging.environment !== 'staging' || staging.environmentId !== 'dde1b6c2-9225-46d3-ae43-c20fd2456d3b' || staging.convexUrl !== 'https://striped-starling-234.convex.cloud') throw new Error('Promotion evidence must belong to the dedicated staging environment.');
  if (staging.distributedExports !== config.distributedExports || staging.distributedExports !== !!receipt.distributedTaskId) throw new Error('Promotion must preserve the verified distributed-export mode.');
  for (const key of kinds.flatMap(kind => [`${kind}Commit`, `${kind}Image`])) if (staging[key] !== config[key]) throw new Error('Production must promote exactly the source commits and image digests verified in staging.');
  const settings = parseEnv(await readFile(stagingEnvFile, 'utf8'));
  if (settings.CONVEX_DEPLOYMENT !== 'prod:striped-starling-234' || settings.NEXT_PUBLIC_CONVEX_URL !== staging.convexUrl || !settings.RENDER_WORKER_SECRET) throw new Error('Use separate staging credentials for live promotion verification.');
  const token = settings.RAILWAY_API_TOKEN;
  await verifyRailwayTarget({ token, config: staging });
  const client = new ConvexHttpClient(staging.convexUrl);
  const evidence = z.object({ processorCommit: z.string(), exportsCommit: z.string(), processorImage: z.string(), exportsImage: z.string() }).parse(await client.query(makeFunctionReference('railwayWorkers:releaseEvidence'), {
    workerSecret: settings.RENDER_WORKER_SECRET, projectId: receipt.projectId, processorTaskId: receipt.processorTaskId, exportTaskId: receipt.exportTaskId, ultraTaskId: receipt.ultraTaskId, ...(receipt.distributedTaskId ? { distributedTaskId: receipt.distributedTaskId } : {}),
  }));
  for (const key of ['processorCommit', 'exportsCommit', 'processorImage', 'exportsImage']) if (evidence[key] !== staging[key]) throw new Error('Live staging backend no longer matches this promotion.');
  const requiredRoles = ['processor', 'export', 'ultra', ...(config.distributedExports ? ['distributed'] : [])];
  if (receipt.deployments.length !== requiredRoles.length || requiredRoles.some(role => receipt.deployments.filter(entry => entry.role === role).length !== 1)) throw new Error('Processing, standard and Ultra deployment evidence are required, plus chunks when enabled.');
  for (const entry of receipt.deployments) {
    const processor = entry.role === 'processor';
    const expectedTask = entry.role === 'processor' ? receipt.processorTaskId : entry.role === 'export' ? receipt.exportTaskId : entry.role === 'ultra' ? receipt.ultraTaskId : receipt.distributedTaskId;
    const slots = processor ? staging.processorServices : entry.role === 'export' ? staging.standardServices : entry.role === 'ultra' ? staging.ultraServices : [...staging.standardServices, ...staging.ultraServices];
    if (entry.taskId !== expectedTask || !slots.includes(entry.serviceId)) throw new Error('Staging job/deployment evidence does not match its lane.');
    const data = z.object({ deployment: z.object({ serviceId: z.string(), environmentId: z.string(), meta: z.record(z.string(), z.unknown()).nullable() }), deploymentLogs: z.unknown() }).parse(await railway({ token,
      query: 'query($id: String!) { deployment(id: $id) { serviceId environmentId meta } deploymentLogs(deploymentId: $id, limit: 500) { message attributes { key value } } }', variables: { id: entry.deploymentId },
    }));
    const commit = processor ? staging.processorCommit : staging.exportsCommit, image = processor ? staging.processorImage : staging.exportsImage;
    // A repository build names its commit; an image slot runs the digest itself, which is what production then deploys.
    if (data.deployment.serviceId !== entry.serviceId || data.deployment.environmentId !== staging.environmentId || !railwayDeploymentRuns(data.deployment, { commit, image })) throw new Error('Staging deployment has a different source revision or target.');
    if (typeof data.deployment.meta?.commitHash !== 'string' && (await railwayInstance({ token, config: staging, serviceId: entry.serviceId })).source?.image !== image) throw new Error('The staging slot no longer runs the proven image digest.');
    const events = railwayLogEvents(data.deploymentLogs);
    if (!events.some(event => event.event === 'railway-runtime-verified' && event.commit === commit && event.image === image) || !events.some(event => event.event === 'media-completed' && event.taskId === entry.taskId && event.projectId === receipt.projectId)) throw new Error('Authenticated Railway logs do not prove completion of the staging job on the verified build.');
    if (entry.role === 'distributed' && (!events.some(event => event.event === 'chunks-launched' && event.machines >= 1) || !events.some(event => event.event === 'remote-chunks-done') || !events.some(event => event.event === 'assembled'))) throw new Error('Staging evidence must prove remote chunks and successful assembly.');
  }
  console.log(`Staging promotion verified: ${receipt.projectId}; processing and configured export lanes completed on the exact source commits and artifacts.`);
  // The receipt proved both kinds against live staging just now: record them, so a later stage of the same digests
  // (the other kind of this release after staging moved on, a retry, a restore) does not depend on staging standing still.
  const entries = await readLedger();
  const receiptId = receipt.id ?? receipt.projectId;
  for (const kind of ['processor', 'exports']) {
    const existing = entries.find(entry => sameDigest(entry, staging, kind));
    if (existing) Object.assign(existing, { verifiedAt: new Date().toISOString(), receiptId });
    else entries.push({ kind, commit: staging[`${kind}Commit`], image: staging[`${kind}Image`], distributedExports: staging.distributedExports, receiptId, verifiedAt: new Date().toISOString() });
  }
  await writeLedger(entries);
  return staging;
}

/** The staging manifest the `Railway staging` workflow built, runtime-checked and uploaded for one main commit
 *  (artifact `railway-staging-manifest`). It pins the image digests that commit produced; nothing here is trusted
 *  beyond that: promotion still checks them against the live staging backend, and a bypass logs itself.
 * @param {{ commit: string, env?: NodeJS.ProcessEnv, directory?: string, file?: string }} args */
export async function stagingManifestFor({ commit, env = process.env, directory = '.data/railway', file }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A full commit SHA is required to find its staging manifest.');
  const { mkdir, mkdtemp, copyFile, rm } = await import('node:fs/promises');
  const { join, resolve } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { command } = await import('./release-command.mjs');
  const { REPOSITORY } = await import('../lib/repository.mjs');
  const path = file ? resolve(file) : resolve(directory, `staging-${commit}.json`);
  // Always the newest successful run: a rerun of the workflow for the same commit builds new digests.
  if (!file) {
    const runs = JSON.parse(await command('gh', ['run', 'list', '--repo', REPOSITORY, '--workflow', 'Railway staging', '--commit', commit, '--status', 'success', '--limit', '1', '--json', 'databaseId'], { env, quiet: true }));
    if (!runs.length) throw new Error(`Staging has not staged ${commit} yet: no successful "Railway staging" run for that commit. It runs on every push to main; wait for it (or rerun it) and try again.`);
    const scratch = await mkdtemp(join(tmpdir(), 'railway-staging-manifest-'));
    try {
      await command('gh', ['run', 'download', String(runs[0].databaseId), '--repo', REPOSITORY, '--name', 'railway-staging-manifest', '--dir', scratch], { env, quiet: true });
      await mkdir(resolve(directory), { recursive: true });
      await copyFile(join(scratch, 'staging.json'), path);
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
  const staging = railwayConfig(await readFile(path, 'utf8'));
  if (staging.environment !== 'staging' || staging.processorCommit !== commit || staging.exportsCommit !== commit) throw new Error(`${path} is not the staging manifest of ${commit}.`);
  return { staging, path };
}

/** The one rule for a founder bypass reason, shared by release:prod and railway-workers.mjs so a bad reason is
 *  refused before anything is deployed. Returns the trimmed reason. @param {string | undefined} value */
export function founderBypassReason(value) {
  const reason = value?.trim();
  if (!reason || reason.length < 15 || !/[a-z]/i.test(reason)) throw new Error('--founder-bypass needs the reason the founder gave, in words (at least 15 characters).');
  return reason;
}
