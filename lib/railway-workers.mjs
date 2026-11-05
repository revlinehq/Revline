import { z } from 'zod';

export const RAILWAY_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
export const RAILWAY_BUDGET = Object.freeze({ vCPUs: 4, memoryGB: 8 });
export const RAILWAY_CPU_ENV = Object.freeze({
  REVLINE_RENDER_WORKERS: '2', REVLINE_RENDER_FFMPEG_SLOTS: '2', REVLINE_RENDER_ENCODE_THREADS: '4',
  MEDIA_PROCESSOR_THREADS: '4', MEDIA_PREVIEW_CPUS: '4', BEAT_TRACK_THREADS: '4',
  OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4', OMP_THREAD_LIMIT: '4',
});
const image = z.string().regex(/^ghcr\.io\/zurahq\/revline-(processor|exports)(-dev)?@sha256:[a-f0-9]{64}$/);
const ids = z.array(z.string().uuid());
export class RailwayRateLimitError extends Error {
  constructor(retryAfterMs) { super(`Railway API rate limited; retry after ${Math.ceil(retryAfterMs / 1000)} seconds. Queue retained.`); this.retryAfterMs = retryAfterMs; }
}
let nextRequestAt = 0;
export const railwayConfigSchema = z.object({
  environment: z.enum(['dev', 'production']), projectId: z.string().uuid(), environmentId: z.string().uuid(),
  convexUrl: z.string().url(), region: z.enum(['us-east4-eqdc4a', 'us-west2', 'europe-west4-drams3a', 'asia-southeast1-eqsg3a']),
  processorImage: image, exportsImage: image,
  processorServices: ids.max(8), standardServices: ids.max(100), ultraServices: ids.max(100),
  distributedExports: z.boolean().default(false),
  artifactBucket: z.string().min(1).optional(), artifactEndpoint: z.string().url().optional(),
}).strict().superRefine((config, ctx) => {
  const production = config.environment === 'production';
  if (config.convexUrl !== `https://${production ? 'different-gnu-398' : 'majestic-alpaca-541'}.convex.cloud`) ctx.addIssue({ code: 'custom', message: 'Railway/Convex environment mismatch.' });
  for (const kind of ['processor', 'exports']) {
    if (!config[`${kind}Image`].startsWith(`ghcr.io/zurahq/revline-${kind}${production ? '' : '-dev'}@sha256:`)) ctx.addIssue({ code: 'custom', message: 'Image belongs to another worker/environment.' });
  }
  const slots = [...config.processorServices, ...config.standardServices, ...config.ultraServices];
  if (new Set(slots).size !== slots.length) ctx.addIssue({ code: 'custom', message: 'Each worker needs its own service.' });
  if (config.distributedExports && (!config.artifactBucket || !config.artifactEndpoint?.startsWith('https://'))) ctx.addIssue({ code: 'custom', message: 'Pin this environment’s existing distributed artifact bucket and HTTPS endpoint.' });
});

/** @param {unknown} raw */
export function railwayConfig(raw) { return railwayConfigSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw); }

/** Project tokens are environment scoped. Never accept an account-token fallback.
 * @param {{ token: string, query: string, variables?: Record<string, unknown> }} args
 * @returns {Promise<unknown>} */
export async function railway({ token, query, variables = {} }) {
  if (!token) throw new Error('RAILWAY_API_TOKEN must be a project/environment token.');
  const delay = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Date.now() + delay + 150;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  const response = await fetch(RAILWAY_ENDPOINT, {
    method: 'POST', headers: { 'Project-Access-Token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 429) {
    const retry = response.headers.get('retry-after');
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
    const retryAt = retry && !Number.isFinite(Number(retry)) ? Date.parse(retry) : Date.now() + Number(retry) * 1000;
    throw new RailwayRateLimitError(Math.max(60_000, (Number.isFinite(retryAt) && retry ? retryAt : reset || Date.now() + 3600_000) - Date.now()));
  }
  if (!response.ok) throw new Error(`Railway API HTTP ${response.status}. Queue retained.`);
  const result = z.object({ data: z.unknown().optional(), errors: z.array(z.object({ message: z.string() })).optional() }).parse(await response.json());
  // Do not echo GraphQL errors: variable validation messages can include secrets.
  if (result.errors?.length || !result.data) throw new Error('Railway GraphQL request failed. Check Railway permissions/schema; queue retained.');
  return result.data;
}

/** @param {{ token: string, config: ReturnType<typeof railwayConfig> }} args */
export async function verifyRailwayTarget({ token, config }) {
  const result = z.object({ projectToken: z.object({ projectId: z.string(), environmentId: z.string() }) }).parse(await railway({ token, query: 'query { projectToken { projectId environmentId } }' }));
  if (result.projectToken.projectId !== config.projectId || result.projectToken.environmentId !== config.environmentId) throw new Error('Railway project token targets another environment.');
}

const deploymentSchema = z.object({ id: z.string(), status: z.string(), deploymentStopped: z.boolean() });
const instanceSchema = z.object({
  serviceId: z.string(), serviceName: z.string(), numReplicas: z.number().nullable(), region: z.string().nullable(),
  startCommand: z.string().nullable(),
  restartPolicyType: z.string(), sleepApplication: z.boolean().nullable(), source: z.object({ image: z.string().nullable(), repo: z.string().nullable() }).nullable(),
  latestDeployment: deploymentSchema.nullable(), activeDeployments: z.array(deploymentSchema),
});
/** @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string }} args */
export async function railwayInstance({ token, config, serviceId }) {
  const result = z.object({ serviceInstance: instanceSchema }).parse(await railway({ token,
    query: `query($serviceId: String!, $environmentId: String!) { serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
      serviceId serviceName numReplicas region startCommand restartPolicyType sleepApplication source { image repo }
      latestDeployment { id status deploymentStopped } activeDeployments { id status deploymentStopped }
    } }`, variables: { serviceId, environmentId: config.environmentId },
  }));
  return result.serviceInstance;
}

/** A successful process exit is deploymentStopped, not a Fly "stopped" state.
 * Unknown states hold capacity rather than triggering duplicate work.
 * @param {z.infer<typeof instanceSchema>} instance */
export function railwayActive(instance) {
  const active = deployment => !deployment.deploymentStopped && !['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'].includes(deployment.status);
  return instance.activeDeployments.some(active) || !!(instance.latestDeployment && active(instance.latestDeployment));
}

/** @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string }} args */
async function verifyRailwayLimits({ token, config, serviceId }) {
  // The mutation accepts vCPUs/GB; its JSON scalar readback uses CPU/bytes.
  // Require explicit overrides as well as merged limits; plan defaults are unsafe.
  const limits = z.object({ cpu: z.number().positive().max(4), memoryBytes: z.number().positive().max(8192 * 1024 * 1024) });
  z.object({ serviceInstanceLimits: z.object({ containers: limits }), serviceInstanceLimitOverride: z.object({ containers: limits }) }).parse(await railway({ token,
    query: 'query($serviceId: String!, $environmentId: String!) { serviceInstanceLimits(serviceId: $serviceId, environmentId: $environmentId) serviceInstanceLimitOverride(serviceId: $serviceId, environmentId: $environmentId) }',
    variables: { serviceId, environmentId: config.environmentId },
  }));
}

/** @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string, image: string }} args */
export async function verifyRailwaySlot({ token, config, serviceId, image }) {
  const instance = await railwayInstance({ token, config, serviceId });
  if (instance.numReplicas !== 1 || instance.region !== config.region || instance.startCommand !== 'sh infra/media-worker/railway-entry.sh' || instance.restartPolicyType !== 'NEVER' || instance.sleepApplication || instance.source?.image !== image || instance.source.repo) throw new Error(`Railway slot ${serviceId} configuration drift; dispatch held.`);
  await verifyRailwayLimits({ token, config, serviceId });
  return instance;
}

/** @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string }} args */
export async function deployRailwaySlot({ token, config, serviceId }) {
  const instance = await railwayInstance({ token, config, serviceId });
  if (railwayActive(instance)) {
    const deployment = instance.activeDeployments.find(deployment => railwayActive({ ...instance, latestDeployment: deployment, activeDeployments: [] })) || instance.latestDeployment;
    if (!deployment) throw new Error('Railway active deployment identity is unavailable; start held.');
    return deployment.id;
  }
  return z.object({ serviceInstanceDeployV2: z.string() }).parse(await railway({ token,
    query: 'mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }',
    variables: { serviceId, environmentId: config.environmentId },
  })).serviceInstanceDeployV2;
}

/** Configure empty/stopped services only; no repository autodeploy or unbounded defaults.
 * @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string, image: string, variables: Record<string, string> }} args */
export async function configureRailwaySlot({ token, config, serviceId, image, variables }) {
  const instance = await railwayInstance({ token, config, serviceId });
  if (!instance.serviceName.startsWith(`revline-${config.environment}-`) && !instance.serviceName.startsWith(`rv-t-${config.environment === 'production' ? 'p' : 'd'}-`)) throw new Error('Refusing to configure a service outside the Revline worker namespace.');
  if (instance.source?.repo) throw new Error('Refusing to replace a repository-backed service.');
  if (railwayActive(instance)) throw new Error('Drain the Railway service before changing its image or settings.');
  const target = { serviceId, environmentId: config.environmentId };
  z.object({ serviceInstanceLimitsUpdate: z.literal(true) }).parse(await railway({ token, query: 'mutation($input: ServiceInstanceLimitsUpdateInput!) { serviceInstanceLimitsUpdate(input: $input) }', variables: { input: { ...target, ...RAILWAY_BUDGET } } }));
  await verifyRailwayLimits({ token, config, serviceId });
  z.object({ variableCollectionUpsert: z.literal(true) }).parse(await railway({ token, query: 'mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }', variables: { input: { ...target, projectId: config.projectId, variables, replace: true, skipDeploys: true } } }));
  z.object({ serviceInstanceUpdate: z.literal(true) }).parse(await railway({ token, query: 'mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }', variables: { ...target, input: {
    source: { image }, startCommand: 'sh infra/media-worker/railway-entry.sh', region: config.region,
    numReplicas: 1, multiRegionConfig: { [config.region]: { numReplicas: 1 } }, restartPolicyType: 'NEVER',
    sleepApplication: false, healthcheckPath: null, cronSchedule: null, preDeployCommand: [],
    drainingSeconds: 3000, overlapSeconds: 0,
  } } }));
  await verifyRailwaySlot({ token, config, serviceId, image });
}

/** Create without source so limits are set BEFORE the first container is scheduled.
 * @param {{ token: string, config: ReturnType<typeof railwayConfig>, name: string }} args */
export async function createRailwayService({ token, config, name }) {
  return z.object({ serviceCreate: z.object({ id: z.string() }) }).parse(await railway({ token,
    query: 'mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }',
    variables: { input: { projectId: config.projectId, environmentId: config.environmentId, name } },
  })).serviceCreate.id;
}

/** @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string }} args */
export async function deleteRailwayService({ token, config, serviceId }) {
  z.object({ serviceDelete: z.literal(true) }).parse(await railway({ token, query: 'mutation($id: String!, $environmentId: String!) { serviceDelete(id: $id, environmentId: $environmentId) }', variables: { id: serviceId, environmentId: config.environmentId } }));
}

/** Sweep only this environment's expired temporary services, including lost create ACKs.
 * @param {{ token: string, config: ReturnType<typeof railwayConfig> }} args */
export async function reapRailwayServices({ token, config }) {
  const prefix = `rv-t-${config.environment === 'production' ? 'p' : 'd'}-`;
  let after = null;
  do {
    const result = z.object({ environment: z.object({ serviceInstances: z.object({
      edges: z.array(z.object({ node: z.object({ serviceId: z.string(), serviceName: z.string() }) })),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    }) }) }).parse(await railway({ token,
      query: 'query($id: String!, $after: String) { environment(id: $id) { serviceInstances(first: 100, after: $after) { edges { node { serviceId serviceName } } pageInfo { hasNextPage endCursor } } } }', variables: { id: config.environmentId, after },
    }));
    for (const { node } of result.environment.serviceInstances.edges) {
      const suffix = node.serviceName.startsWith(prefix) ? /^(\d{13})-[a-f0-9]{8}$/.exec(node.serviceName.slice(prefix.length)) : null;
      if (suffix && Date.now() - Number(suffix[1]) > 55 * 60_000) await deleteRailwayService({ token, config, serviceId: node.serviceId });
    }
    const { hasNextPage, endCursor } = result.environment.serviceInstances.pageInfo;
    if (hasNextPage && (!endCursor || endCursor === after)) throw new Error('Railway service pagination stalled; cleanup held.');
    after = hasNextPage ? endCursor : null;
  } while (after);
}
