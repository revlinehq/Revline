import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { z } from 'zod';
import { railway, railwayConfig, railwayLogEvents, verifyRailwayTarget } from '../lib/railway-workers.mjs';

const receiptSchema = z.object({
  config: z.unknown(), projectId: z.string(), processorTaskId: z.string(), exportTaskId: z.string(), distributedTaskId: z.string(),
  deployments: z.array(z.object({ role: z.enum(['processor', 'export', 'distributed']), serviceId: z.string().uuid(), deploymentId: z.string().uuid(), taskId: z.string() })).length(3),
});

export async function verifyStagingPromotion({ config, receiptFile, stagingEnvFile, kinds = ['processor', 'exports'] }) {
  if (!receiptFile || !stagingEnvFile) throw new Error('Production requires a staging receipt and a separate staging environment file.');
  const receipt = receiptSchema.parse(JSON.parse(await readFile(receiptFile, 'utf8')));
  const staging = railwayConfig(receipt.config);
  if (staging.environment !== 'staging' || staging.environmentId !== 'dde1b6c2-9225-46d3-ae43-c20fd2456d3b' || staging.convexUrl !== 'https://striped-starling-234.convex.cloud') throw new Error('Promotion evidence must belong to the dedicated staging environment.');
  for (const key of kinds.flatMap(kind => [`${kind}Commit`, `${kind}Image`])) if (staging[key] !== config[key]) throw new Error('Production must promote exactly the source commits and image digests verified in staging.');
  const settings = parseEnv(await readFile(stagingEnvFile, 'utf8'));
  if (settings.CONVEX_DEPLOYMENT !== 'prod:striped-starling-234' || settings.NEXT_PUBLIC_CONVEX_URL !== staging.convexUrl || !settings.RENDER_WORKER_SECRET) throw new Error('Use separate staging credentials for live promotion verification.');
  const token = settings.RAILWAY_API_TOKEN;
  await verifyRailwayTarget({ token, config: staging });
  const client = new ConvexHttpClient(staging.convexUrl);
  const evidence = z.object({ processorCommit: z.string(), exportsCommit: z.string(), processorImage: z.string(), exportsImage: z.string() }).parse(await client.query(makeFunctionReference('railwayWorkers:releaseEvidence'), {
    workerSecret: settings.RENDER_WORKER_SECRET, projectId: receipt.projectId, processorTaskId: receipt.processorTaskId, exportTaskId: receipt.exportTaskId, distributedTaskId: receipt.distributedTaskId,
  }));
  for (const key of ['processorCommit', 'exportsCommit', 'processorImage', 'exportsImage']) if (evidence[key] !== staging[key]) throw new Error('Live staging backend no longer matches this promotion.');
  if (new Set(receipt.deployments.map(value => value.role)).size !== 3) throw new Error('Processing, standard export and distributed export deployment evidence are required.');
  for (const entry of receipt.deployments) {
    const processor = entry.role === 'processor';
    const expectedTask = entry.role === 'processor' ? receipt.processorTaskId : entry.role === 'export' ? receipt.exportTaskId : receipt.distributedTaskId;
    const slots = processor ? staging.processorServices : [...staging.standardServices, ...staging.ultraServices];
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
  console.log(`Staging promotion verified: ${receipt.projectId}; processor/export/distributed jobs completed on the exact source commits and artifacts.`);
  return staging;
}
