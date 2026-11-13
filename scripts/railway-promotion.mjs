import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { railwayBootCrashed, railwayDeployments, railwayDeploymentCommit, railwayGoodDeployments } from '../lib/railway-workers.mjs';

// A pinned-image production `stage` is a rollback: it may only put a lane back on a build production already ran.
// There is no staging environment any more (Railway slots deploy from GitHub main, and production holds a build that
// crashes before media-ready). Production history is either of:
//   1. this checkout's ledger of earlier production stages of the same commit and digest (LEDGER), or
//   2. Railway's own deployment history: a production slot of that lane built and ran the commit from GitHub main
//      (among each slot's 50 newest deployments; older builds need the ledger, or a redeploy in the Railway dashboard).
// The image itself is then proven by the stage's runtime preflight, which refuses unless the image reports exactly the
// pinned commit and digest, before any slot changes.
const LEDGER = '.data/railway/promotion-ledger.json';
// Entries written before staging was removed also carry receiptId and verifiedAt; both are optional now.
const ledgerSchema = z.array(z.object({
  kind: z.enum(['processor', 'exports']), commit: z.string().regex(/^[a-f0-9]{40}$/), image: z.string(), distributedExports: z.boolean(),
  receiptId: z.string().optional(), verifiedAt: z.string().datetime().optional(), productionStagedAt: z.string().datetime().optional(),
}).passthrough());
/** An unreadable record counts as empty: Railway's deployment history is still checked. */
async function readLedger() {
  try { return ledgerSchema.parse(JSON.parse(await readFile(resolve(LEDGER), 'utf8'))); }
  catch (error) { if (error?.code !== 'ENOENT') console.log(`Ignoring unreadable ${LEDGER} (${error instanceof Error ? error.message : error}).`); return []; }
}
/** Atomic replace; keeps only entries production ran. */
async function writeLedger(entries) {
  const path = resolve(LEDGER), temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, JSON.stringify(entries.filter(entry => entry.productionStagedAt), null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}
// Distributed exports change only what an export digest is proven to do; a processor digest is the same either way.
const sameDigest = (entry, config, kind) => entry.kind === kind && entry.commit === config[`${kind}Commit`] && entry.image === config[`${kind}Image`] && (kind === 'processor' || entry.distributedExports === config.distributedExports);
const laneServices = (config, kind) => kind === 'processor' ? config.processorServices : [...config.standardServices, ...config.ultraServices];

/** Records `kinds` of the production manifest `config` as run in production, so the same commit and digest can be
 *  staged again later (a restore) without depending on how far back Railway lists deployments. */
export async function recordProductionStage({ config, kinds }) {
  const entries = await readLedger();
  const at = new Date().toISOString();
  for (const kind of kinds) {
    const existing = entries.find(entry => sameDigest(entry, config, kind));
    if (existing) existing.productionStagedAt = at;
    else entries.push({ kind, commit: config[`${kind}Commit`], image: config[`${kind}Image`], distributedExports: config.distributedExports, productionStagedAt: at });
  }
  await writeLedger(entries);
  console.log(`Recorded in ${LEDGER}: production runs ${kinds.map(kind => `${kind} ${config[`${kind}Commit`].slice(0, 7)}`).join(', ')}.`);
}

/** Refuses a production stage of any kind whose pinned commit production never ran (see the top of this file).
 * @param {{ config: import('../lib/railway-workers.mjs').RailwayConfig, kinds: ('processor' | 'exports')[], token: string }} args */
export async function verifyProductionHistory({ config, kinds, token }) {
  const entries = await readLedger();
  for (const kind of kinds) {
    const commit = config[`${kind}Commit`], image = config[`${kind}Image`];
    const recorded = entries.find(entry => entry.productionStagedAt && sameDigest(entry, config, kind));
    if (recorded) { console.log(`Production history: ${kind} ${commit.slice(0, 7)} ${image} was staged in production ${recorded.productionStagedAt} (${LEDGER}).`); continue; }
    let ran = null;
    for (const serviceId of laneServices(config, kind)) {
      // Builds that ran (SUCCESS, SLEEPING) count as they are. A superseded one (REMOVED) may have been cancelled before
      // it built, so it counts only when its worker logged media-ready. FAILED and CRASHED builds never count.
      for (const deployment of railwayGoodDeployments(await railwayDeployments({ token, config, serviceId, first: 50 })).filter(deployment => railwayDeploymentCommit(deployment) === commit)) {
        if (deployment.status !== 'REMOVED' || !await railwayBootCrashed({ token, deploymentId: deployment.id })) { ran = { serviceId, deployment }; break; }
      }
      if (ran) break;
    }
    if (!ran) throw new Error(`Production never ran ${kind} ${commit.slice(0, 7)}: it is not in ${LEDGER} and no production ${kind} slot has a deployment of it in Railway. A pinned-image stage only rolls a lane back to a build production already ran; ship anything else through main.`);
    console.log(`Production history: ${kind} ${commit.slice(0, 7)} ran on production slot ${ran.serviceId} (Railway deployment ${ran.deployment.id}, ${ran.deployment.status}). The runtime preflight checks ${image} reports that commit.`);
  }
}
