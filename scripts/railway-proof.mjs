// Produces the staging promotion receipt that production Railway staging requires, without a person running the jobs.
// It starts three real jobs on the isolated STAGING backend (a processing task, a standard export, an Ultra export)
// as the staging service identity `service:railway-proof` (convex/stagingProof.ts), waits for them, finds the Railway
// deployment that completed each, writes the receipt and verifies it the way production will.
// Nothing here touches production, and the receipt requirement itself is unchanged (scripts/railway-promotion.mjs).
//
//   node scripts/railway-proof.mjs --check                 exit 0 when the one-time staging setup exists, 3 when not
//   node scripts/railway-proof.mjs [--commit <sha>]        run the proof for that commit (default HEAD)
//   node scripts/railway-proof.mjs --dry-run               print the plan; no network calls
// Options: --staging-env-file (.data/railway/staging.env), --config <staging manifest>, --receipt (.data/railway/promotion.json),
//          --timeout-minutes (40), --fresh (rerun even when a valid receipt for this commit and these digests exists)
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { z } from 'zod';
import { command, mask, redact } from './release-command.mjs';
import { stagingManifestFor, verifyStagingPromotion } from './railway-promotion.mjs';
import { railway, railwayConfig, railwayDeploymentRuns, railwayInstance, railwayLogEvents, verifyRailwayTarget } from '../lib/railway-workers.mjs';

const STAGING = 'striped-starling-234', STAGING_URL = `https://${STAGING}.convex.cloud`;
const SETUP_MISSING = 3;
// A retry within this window reuses the receipt; staging prunes finished tasks after about 7 days anyway.
const RECEIPT_TTL_MS = 24 * 3600_000;
const { values } = parseArgs({ options: {
  check: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, commit: { type: 'string' }, config: { type: 'string' },
  'staging-env-file': { type: 'string', default: '.data/railway/staging.env' }, receipt: { type: 'string', default: '.data/railway/promotion.json' },
  'timeout-minutes': { type: 'string', default: '40' }, fresh: { type: 'boolean' },
} });
const envFile = resolve(values['staging-env-file']), receiptFile = resolve(values.receipt);
const timeoutMs = z.coerce.number().min(5).max(180).parse(values['timeout-minutes']) * 60_000;
const commit = values.commit ? execFileSync('git', ['rev-parse', `${values.commit}^{commit}`], { encoding: 'utf8' }).trim() : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const wait = ms => new Promise(done => setTimeout(done, ms));

if (values['dry-run']) {
  console.log([
    `Railway promotion proof for ${commit} (dry run: no network calls, nothing started).`,
    `1. Read staging credentials from ${envFile} (must target prod:${STAGING}).`,
    `2. Take the staging manifest of this commit: ${values.config ? resolve(values.config) : 'artifact railway-staging-manifest of its successful "Railway staging" run'}.`,
    `3. If ${receiptFile} proved this commit and these image digests less than ${RECEIPT_TTL_MS / 3600_000} h ago and still verifies live: print "reusing proof receipt <id>" and stop here${values.fresh ? ' (skipped: --fresh)' : ''}.`,
    '   Otherwise check the live staging backend holds that manifest and routes processing and exports to Railway.',
    '4. convex run stagingProof:start: one timeline frame (processor), one 1080p export (standard), one 2160p export (Ultra), on the fixture project of service:railway-proof.',
    `5. Wait up to ${timeoutMs / 60_000} minutes for all three to complete; find the Railway deployment that completed each from its logs.`,
    `6. Write ${receiptFile} and verify it with the same check production staging runs.`,
  ].join('\n'));
  process.exit(0);
}

// One-time setup: staging credentials on this machine, and a staging backend that has the proof functions.
const missing = [];
let settings = {};
try { settings = parseEnv(await readFile(envFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; missing.push(`${envFile} does not exist (the staging credentials file).`); }
mask(settings);
if (!missing.length) {
  if (settings.CONVEX_DEPLOYMENT !== `prod:${STAGING}`) missing.push(`CONVEX_DEPLOYMENT must be prod:${STAGING}.`);
  if (settings.NEXT_PUBLIC_CONVEX_URL !== STAGING_URL) missing.push(`NEXT_PUBLIC_CONVEX_URL must be ${STAGING_URL}.`);
  if (!settings.CONVEX_DEPLOY_KEY?.startsWith(`prod:${STAGING}|`)) missing.push('CONVEX_DEPLOY_KEY must be a deploy key of the staging deployment.');
  if (!settings.RAILWAY_API_TOKEN) missing.push('RAILWAY_API_TOKEN (the staging environment project token) is not set.');
  if (!settings.RENDER_WORKER_SECRET) missing.push('RENDER_WORKER_SECRET (the staging processor secret) is not set.');
}
// The staging deploy key selects the deployment; never inherit another session's selection.
const env = { ...process.env, CONVEX_DEPLOY_KEY: settings.CONVEX_DEPLOY_KEY };
for (const name of ['CONVEX_DEPLOYMENT', 'NEXT_PUBLIC_CONVEX_URL', 'RAILWAY_API_TOKEN']) delete env[name];
const convex = async args => command(process.execPath, ['node_modules/convex/bin/main.js', ...args], { env, quiet: true });
const run = async (name, args = {}) => JSON.parse(await convex(['run', name, JSON.stringify(args)]));
let ready;
if (!missing.length) {
  try { ready = z.object({ processorBackend: z.string(), renderProvider: z.string(), paused: z.boolean(), fixtureProjectId: z.string().nullable() }).parse(await run('stagingProof:ready')); }
  catch {
    // Only a backend without the function is "setup missing". Anything else (network, a refused key) is an error:
    // the release must stop there instead of skipping the processor. The CLI's own message tells them apart.
    const again = spawnSync(process.execPath, ['node_modules/convex/bin/main.js', 'run', 'stagingProof:ready', '{}'], { env, encoding: 'utf8' });
    const output = redact(`${again.stdout ?? ''}${again.stderr ?? ''}`).trim();
    if (/Could not find function/i.test(output)) missing.push('The staging backend does not have stagingProof:ready yet (the "Railway staging" workflow deploys it on the next push to main).');
    else { console.error(`Railway promotion proof: staging could not be asked whether the setup exists. This is an error, not a missing setup; try again.\n${output.split('\n').slice(-6).join('\n')}`); process.exit(1); }
  }
  if (ready && (ready.processorBackend !== 'railway' || ready.renderProvider !== 'railway')) missing.push(`Staging must route processing and exports to Railway (now: processor ${ready.processorBackend}, exports ${ready.renderProvider || 'local'}).`);
}
if (missing.length) {
  console.error(`Railway promotion proof: the one-time staging setup is incomplete.\n${missing.map(item => `  - ${item}`).join('\n')}\nSee "Railway" in docs/releases.md.`);
  process.exit(SETUP_MISSING);
}
if (values.check) {
  console.log(`Railway promotion proof: setup exists (staging credentials, proof functions${ready.fixtureProjectId ? ', fixture project' : '; the fixture project is created on the first run'}${ready.paused ? '; staging workers are PAUSED' : ''}).`);
  process.exit(0);
}

/** A retry of the same release reuses the receipt it already earned: same commit, same image digests (the newest
 *  successful staging build of that commit), younger than RECEIPT_TTL_MS, and still passing the full live check
 *  production runs. Anything else returns null and the proof runs again. Returns the receipt id. */
async function reusableReceipt(staging) {
  let raw;
  try { raw = JSON.parse(await readFile(receiptFile, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; console.log(`Proof receipt ${receiptFile} is unreadable; running the proof.`); return null; }
  const saved = z.object({ id: z.string().uuid(), createdAt: z.string().datetime(), config: z.unknown() }).safeParse(raw);
  if (!saved.success) { console.log('The saved proof receipt has no id (made before reuse existed); running the proof.'); return null; }
  const { id, createdAt } = saved.data;
  const age = Date.now() - Date.parse(createdAt);
  if (!(age >= 0 && age < RECEIPT_TTL_MS)) { console.log(`Proof receipt ${id} is ${Math.round(age / 3600_000)} h old (limit ${RECEIPT_TTL_MS / 3600_000} h); running the proof.`); return null; }
  let proven;
  try { proven = railwayConfig(saved.data.config); } catch { console.log(`Proof receipt ${id} has an invalid manifest; running the proof.`); return null; }
  for (const key of ['processorCommit', 'exportsCommit', 'processorImage', 'exportsImage']) if (proven[key] !== staging[key]) { console.log(`Proof receipt ${id} proved ${key} ${proven[key]}, not ${staging[key]}; running the proof.`); return null; }
  try { await verifyStagingPromotion({ config: staging, receiptFile, stagingEnvFile: envFile }); }
  catch (error) { console.log(`Proof receipt ${id} no longer verifies (${redact(error instanceof Error ? error.message : String(error))}); running the proof.`); return null; }
  return id;
}

try {
  const { staging, path: manifest } = await stagingManifestFor({ commit, env: process.env, file: values.config });
  const reused = values.fresh ? null : await reusableReceipt(staging);
  if (reused) console.log(`reusing proof receipt ${reused}`);
  else {
    if (ready.paused) throw new Error('Staging Railway workers are paused; resume them before a promotion proof.');
    if (staging.distributedExports) throw new Error('Distributed exports need chunk evidence this proof does not produce; run that promotion by hand.');
    const token = settings.RAILWAY_API_TOKEN;
    await verifyRailwayTarget({ token, config: staging });
    // A later push to main restages staging. Jobs run now would then prove a different build.
    const live = railwayConfig(parseEnv(await convex(['env', 'list'])).RAILWAY_WORKERS_JSON);
    for (const key of ['processorCommit', 'exportsCommit', 'processorImage', 'exportsImage']) if (live[key] !== staging[key]) throw new Error(`Staging now holds ${live.processorCommit}, not ${commit}. Release the commit staging has staged, or rerun "Railway staging" for this one.`);
    console.log(`Staging manifest ${manifest}: processor and exports at ${commit}. Starting the three proof jobs as service:railway-proof.`);
    const started = z.object({ projectId: z.string(), snapshotId: z.string(), standardJobId: z.string(), ultraJobId: z.string() }).parse(await run('stagingProof:start'));
    const { projectId, ...jobs } = started;
    const state = z.object({ taskId: z.string().nullable(), status: z.string(), error: z.string().optional() });
    const deadline = Date.now() + timeoutMs;
    let tasks, printed = '';
    while (true) {
      tasks = z.object({ processor: state, standard: state, ultra: state }).parse(await run('stagingProof:status', jobs));
      const line = Object.entries(tasks).map(([name, task]) => `${name} ${task.status}`).join(', ');
      if (line !== printed) { console.log(`  ${line}`); printed = line; }
      const failed = Object.entries(tasks).find(([, task]) => ['failed', 'cancelled', 'missing'].includes(task.status));
      if (failed) throw new Error(`The staging ${failed[0]} job ended ${failed[1].status}${failed[1].error ? `: ${failed[1].error}` : ''}. No receipt written.`);
      if (Object.values(tasks).every(task => task.status === 'completed')) break;
      if (Date.now() > deadline) throw new Error(`The staging jobs did not finish in ${timeoutMs / 60_000} minutes (${line}). No receipt written.`);
      await wait(10_000);
    }
    // Each job's lane has explicit services. The deployment that ran it logged media-completed with its task id.
    const lanes = [
      { role: 'processor', taskId: tasks.processor.taskId, services: staging.processorServices, commit: staging.processorCommit, image: staging.processorImage },
      { role: 'export', taskId: tasks.standard.taskId, services: staging.standardServices, commit: staging.exportsCommit, image: staging.exportsImage },
      { role: 'ultra', taskId: tasks.ultra.taskId, services: staging.ultraServices, commit: staging.exportsCommit, image: staging.exportsImage },
    ];
    const completedOn = async lane => {
      for (const serviceId of lane.services) {
        const instance = await railwayInstance({ token, config: staging, serviceId });
        const candidates = [...new Map([instance.latestDeployment, ...instance.activeDeployments].filter(Boolean).map(deployment => [deployment.id, deployment])).values()];
        for (const deployment of candidates) {
          // An image deployment whose metadata names no image counts only while the slot itself runs that digest.
        if (!railwayDeploymentRuns(deployment, lane) || (!deployment.meta?.commitHash && instance.source?.image !== lane.image)) continue;
          const data = z.object({ deploymentLogs: z.unknown() }).parse(await railway({ token, query: 'query($id: String!) { deploymentLogs(deploymentId: $id, limit: 500) { message attributes { key value } } }', variables: { id: deployment.id } }));
          if (railwayLogEvents(data.deploymentLogs).some(event => event.event === 'media-completed' && event.taskId === lane.taskId && event.projectId === projectId)) return { role: lane.role, serviceId, deploymentId: deployment.id, taskId: lane.taskId };
        }
      }
      return null;
    };
    const deployments = [];
    for (const lane of lanes) {
      // Railway indexes logs a few seconds behind the container.
      let found = null;
      for (let attempt = 0; attempt < 12 && !found; attempt++) { found = await completedOn(lane); if (!found) await wait(10_000); }
      if (!found) throw new Error(`The ${lane.role} job completed, but no ${lane.role} deployment at ${lane.commit.slice(0, 7)} logged it. No receipt written.`);
      deployments.push(found);
    }
    const receipt = { id: randomUUID(), createdAt: new Date().toISOString(), config: staging, projectId, processorTaskId: tasks.processor.taskId, exportTaskId: tasks.standard.taskId, ultraTaskId: tasks.ultra.taskId, deployments };
    await mkdir(dirname(receiptFile), { recursive: true });
    await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    // The check production staging runs, against the live staging backend and Railway logs.
    await verifyStagingPromotion({ config: staging, receiptFile, stagingEnvFile: envFile });
  }
  console.log(JSON.stringify({ receipt: receiptFile, stagingEnvFile: envFile }));
} catch (error) {
  console.error(`Railway promotion proof failed: ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exit(1);
}
