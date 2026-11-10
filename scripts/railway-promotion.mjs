import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { z } from 'zod';
import { railway, railwayConfig, railwayLogEvents, verifyRailwayTarget } from '../lib/railway-workers.mjs';

const receiptSchema = z.object({
  config: z.unknown(), projectId: z.string(), processorTaskId: z.string(), exportTaskId: z.string(), ultraTaskId: z.string(), distributedTaskId: z.string().optional(),
  deployments: z.array(z.object({ role: z.enum(['processor', 'export', 'ultra', 'distributed']), serviceId: z.string().uuid(), deploymentId: z.string().uuid(), taskId: z.string() })).min(3).max(4),
});

export async function verifyStagingPromotion({ config, receiptFile, stagingEnvFile, kinds = ['processor', 'exports'] }) {
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
    const data = z.object({ deployment: z.object({ serviceId: z.string(), environmentId: z.string(), meta: z.object({ commitHash: z.string() }) }), deploymentLogs: z.unknown() }).parse(await railway({ token,
      query: 'query($id: String!) { deployment(id: $id) { serviceId environmentId meta } deploymentLogs(deploymentId: $id, limit: 500) { message attributes { key value } } }', variables: { id: entry.deploymentId },
    }));
    const commit = processor ? staging.processorCommit : staging.exportsCommit;
    if (data.deployment.serviceId !== entry.serviceId || data.deployment.environmentId !== staging.environmentId || data.deployment.meta.commitHash !== commit) throw new Error('Staging deployment has a different source revision or target.');
    const events = railwayLogEvents(data.deploymentLogs);
    if (!events.some(event => event.event === 'railway-runtime-verified' && event.commit === commit) || !events.some(event => event.event === 'media-completed' && event.taskId === entry.taskId && event.projectId === receipt.projectId)) throw new Error('Authenticated Railway logs do not prove completion of the staging job on the verified build.');
    if (entry.role === 'distributed' && (!events.some(event => event.event === 'chunks-launched' && event.machines >= 1) || !events.some(event => event.event === 'remote-chunks-done') || !events.some(event => event.event === 'assembled'))) throw new Error('Staging evidence must prove remote chunks and successful assembly.');
  }
  console.log(`Staging promotion verified: ${receipt.projectId}; processing and configured export lanes completed on the exact source commits and artifacts.`);
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
