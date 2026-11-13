import { z } from 'zod';
import { IMAGE_REGISTRIES, REPOSITORY, isRevlineRepository } from './repository.mjs';

export const RAILWAY_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
export const RAILWAY_BUDGET = Object.freeze({ vCPUs: 4, memoryGB: 8 });
export const RAILWAY_CPU_ENV = Object.freeze({
  REVLINE_RENDER_WORKERS: '2', REVLINE_RENDER_FFMPEG_SLOTS: '2',
});
const containerLimits = z.object({ cpu: z.number().finite().positive(), memoryBytes: z.number().finite().positive() });
const registries = IMAGE_REGISTRIES.map(registry => registry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const image = z.string().regex(new RegExp(`^(?:${registries})/revline-railway-(processor|exports)(-dev)?@sha256:[a-f0-9]{64}$`));
const ids = z.array(z.string().uuid());
export class RailwayRateLimitError extends Error {
  constructor(retryAfterMs) { super(`Railway API rate limited; retry after ${Math.ceil(retryAfterMs / 1000)} seconds. Queue retained.`); this.retryAfterMs = retryAfterMs; }
}
let nextRequestAt = 0;
export const railwayConfigSchema = z.object({
  environment: z.enum(['dev', 'production']), projectId: z.string().uuid(), environmentId: z.string().uuid(),
  convexUrl: z.string().url(), region: z.enum(['us-east4-eqdc4a', 'us-west2', 'europe-west4-drams3a', 'asia-southeast1-eqsg3a']),
  // Optional pins. Permanent slots deploy from GitHub main (Railway autodeploy); Railway, not this manifest, picks the
  // commit. A pin is used only by a pinned-image rollback stage and by distributed export chunks (exportsImage).
  processorImage: image.optional(), exportsImage: image.optional(),
  processorCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(), exportsCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  processorServices: ids.max(8), standardServices: ids.max(100), ultraServices: ids.max(100),
  distributedExports: z.boolean().default(false),
  artifactBucket: z.string().min(1).optional(), artifactEndpoint: z.string().url().optional(),
}).strict().superRefine((config, ctx) => {
  if (config.environment !== 'dev') {
    if (config.projectId !== '759ce3c9-db81-4ade-ae3b-2c21070f7442' || config.environmentId !== 'b81548ce-f856-433b-a3aa-80f51d06ddd8') ctx.addIssue({ code: 'custom', message: 'Railway production environment identity mismatch.' });
  } else if (config.projectId === '759ce3c9-db81-4ade-ae3b-2c21070f7442') ctx.addIssue({ code: 'custom', message: 'Local DEV must not use the production Railway project.' });
  const production = config.environment !== 'dev';
  const deployment = { dev: 'majestic-alpaca-541', production: 'different-gnu-398' }[config.environment];
  if (config.convexUrl !== `https://${deployment}.convex.cloud`) ctx.addIssue({ code: 'custom', message: 'Railway/Convex environment mismatch.' });
  for (const kind of ['processor', 'exports']) {
    if (config[`${kind}Image`] === undefined) continue;
    if (!IMAGE_REGISTRIES.some(registry => config[`${kind}Image`].startsWith(`${registry}/revline-railway-${kind}${production ? '' : '-dev'}@sha256:`))) ctx.addIssue({ code: 'custom', message: 'Image belongs to another worker/environment.' });
  }
  const slots = [...config.processorServices, ...config.standardServices, ...config.ultraServices];
  if (new Set(slots).size !== slots.length) ctx.addIssue({ code: 'custom', message: 'Each worker needs its own service.' });
  if (config.distributedExports && !config.exportsImage) ctx.addIssue({ code: 'custom', message: 'Distributed export chunks run the pinned exportsImage; pin it.' });
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

const deploymentSchema = z.object({ id: z.string(), status: z.string(), deploymentStopped: z.boolean(), meta: z.object({ commitHash: z.string().optional() }).passthrough().nullable(), createdAt: z.string().optional() });
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
      latestDeployment { id status deploymentStopped meta } activeDeployments { id status deploymentStopped meta }
    } }`, variables: { serviceId, environmentId: config.environmentId },
  }));
  return result.serviceInstance;
}

/** A successful idle exit is reported through deploymentStopped.
 * Unknown states hold capacity rather than triggering duplicate work.
 * @param {z.infer<typeof instanceSchema>} instance */
export function railwayActive(instance) {
  const active = deployment => {
    if (['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'].includes(deployment.status)) return false;
    return deployment.status === 'SUCCESS' ? !deployment.deploymentStopped : true;
  };
  return instance.activeDeployments.some(active) || !!(instance.latestDeployment && active(instance.latestDeployment));
}

/** @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string }} args */
async function verifyRailwayLimits({ token, config, serviceId }) {
  // The mutation accepts vCPUs/GB; its JSON scalar readback uses CPU/bytes.
  // Read effective dashboard limits without imposing a resource ceiling.
  const result = z.object({ serviceInstanceLimits: z.object({ containers: containerLimits }) }).parse(await railway({ token,
    query: 'query($serviceId: String!, $environmentId: String!) { serviceInstanceLimits(serviceId: $serviceId, environmentId: $environmentId) }',
    variables: { serviceId, environmentId: config.environmentId },
  }));
  return result.serviceInstanceLimits.containers;
}

// New slots start the processor from media-processor/. Slots configured before the
// folder moved (from infra/media-worker) still run images with the old path; they
// stay valid until each one is restaged. Drop the second entry once all are.
const RAILWAY_START_COMMANDS = ['sh media-processor/railway-entry.sh', 'sh infra/media-worker/railway-entry.sh'];

/** Where a slot's code comes from: a pinned registry image, or a Railway build of the repository.
 * Permanent slots build the repository (GitHub main); a pinned-image rollback stage switches them to a registry image.
 * @param {{ source: { image: string | null, repo: string | null } | null }} instance */
export function railwaySlotSource(instance) {
  if (instance.source?.image && !instance.source.repo) return 'image';
  if (instance.source?.repo && !instance.source.image) return 'repository';
  return 'unknown';
}

/** The processor slots kept running while idle: the first `count` of the manifest's processor services
 *  (count from alwaysOnProcessors in lib/worker-capacity.mjs). */
export const railwayWarmSlots = (config, count) => config.processorServices.slice(0, Math.max(0, count));
/** An always-on slot is restarted by Railway when its worker exits with an error, a few times per deployment; after
 *  that the deployment stays CRASHED and the dispatcher's boot-crash hold decides what runs. An idle or draining exit
 *  is exit 0, which Railway does not restart. Every other slot never restarts: it exits when idle. */
export const RAILWAY_WARM_RESTART = Object.freeze({ restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3 });

/** @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string, image: string, source?: 'image' | 'repository' }} args
 *  `source` requires that kind (a release checks what it just configured); without it a permanent slot may be either.
 *  A processor slot may also restart on failure (an always-on slot; the policy outlives turning the setting off). */
export async function verifyRailwaySlot({ token, config, serviceId, image, source }) {
  const instance = await railwayInstance({ token, config, serviceId });
  const placement = await railway({ token, query: 'query($id: String!) { environment(id: $id) { config(decryptVariables: false) } }', variables: { id: config.environmentId } });
  const environment = z.object({ environment: z.object({ config: z.object({ services: z.record(z.string(), z.object({ deploy: z.object({ multiRegionConfig: z.record(z.string(), z.object({ numReplicas: z.number() })) }) })) }) }) }).parse(placement);
  const regions = Object.entries(environment.environment.config.services[serviceId]?.deploy.multiRegionConfig ?? {});
  const permanent = [...config.processorServices, ...config.standardServices, ...config.ultraServices].includes(serviceId);
  const kind = railwaySlotSource(instance);
  const expectedSource = (kind === 'image' && instance.source?.image === image) || (permanent && kind === 'repository' && isRevlineRepository(instance.source?.repo));
  // Repository slots autodeploy from GitHub main: Railway is the deployment controller (docs/releases.md, Railway).
  if (regions.length !== 1 || regions[0][0] !== config.region || regions[0][1].numReplicas !== 1 || !RAILWAY_START_COMMANDS.includes(instance.startCommand ?? '') || !(config.processorServices.includes(serviceId) ? ['NEVER', RAILWAY_WARM_RESTART.restartPolicyType] : ['NEVER']).includes(instance.restartPolicyType) || instance.sleepApplication || !expectedSource || (source && kind !== source)) throw new Error(`Railway slot ${serviceId} configuration drift; dispatch held.`);
  await verifyRailwayLimits({ token, config, serviceId });
  return instance;
}

/** The slot's deployments, newest first.
 * @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string, first?: number }} args */
export async function railwayDeployments({ token, config, serviceId, first = 20 }) {
  const result = z.object({ deployments: z.object({ edges: z.array(z.object({ node: deploymentSchema })) }) }).parse(await railway({ token,
    query: 'query($first: Int!, $input: DeploymentListInput!) { deployments(first: $first, input: $input) { edges { node { id status deploymentStopped meta createdAt } } } }',
    variables: { first, input: { serviceId, environmentId: config.environmentId } },
  }));
  return result.deployments.edges.map(edge => edge.node).sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
}

/** The commit a deployment runs (a GitHub build names it; a registry image deployment does not). */
export const railwayDeploymentCommit = deployment => typeof deployment?.meta?.commitHash === 'string' ? deployment.meta.commitHash : null;

/** Deployments a cold start can redeploy, best first: those that built and ran (SUCCESS, SLEEPING), newest first, then
 *  superseded ones (REMOVED: an earlier build that ran, or one cancelled before it built, which a redeploy refuses).
 *  FAILED builds and still-building deployments are never candidates. */
export const railwayGoodDeployments = (deployments, skip = () => false) => [
  ...deployments.filter(deployment => ['SUCCESS', 'SLEEPING'].includes(deployment.status) && !skip(deployment)),
  ...deployments.filter(deployment => deployment.status === 'REMOVED' && !skip(deployment)),
];
export const railwayGoodDeployment = (deployments, skip) => railwayGoodDeployments(deployments, skip)[0] ?? null;

/** Whether a stopped deployment died before its worker came up: it never logged `media-ready` (the runtime check
 *  and the queue connection run before it). A worker that crashed later, during a task, did log it; the log search is
 *  filtered to that line so a long run does not push it out of the window.
 * @param {{ token: string, deploymentId: string }} args */
export async function railwayBootCrashed({ token, deploymentId }) {
  const result = z.object({ deploymentLogs: z.unknown() }).parse(await railway({ token,
    query: 'query($id: String!) { deploymentLogs(deploymentId: $id, filter: "media-ready", limit: 50) { message attributes { key value } } }', variables: { id: deploymentId },
  }));
  return !railwayLogEvents(result.deploymentLogs).some(event => event.event === 'media-ready');
}

/** Start an idle slot without choosing a commit. An image slot deploys the image it is set to (nothing is built). A
 *  repository slot redeploys `deployment` (default: its latest) from the image Railway already built. An explicitly
 *  chosen `deployment` is always redeployed as it is. Otherwise a slot with no build yet, or whose dashboard limits
 *  changed since its latest build, gets a fresh deployment of its tracked branch.
 * @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string, deployment?: z.infer<typeof deploymentSchema> | null }} args */
export async function deployRailwaySlot({ token, config, serviceId, deployment }) {
  const instance = await railwayInstance({ token, config, serviceId });
  if (railwayActive(instance)) {
    const active = instance.activeDeployments.find(item => railwayActive({ ...instance, latestDeployment: item, activeDeployments: [] })) || instance.latestDeployment;
    if (!active) throw new Error('Railway active deployment identity is unavailable; start held.');
    return active.id;
  }
  const from = deployment === undefined ? instance.latestDeployment : deployment;
  if (railwaySlotSource(instance) === 'repository' && from && from.status !== 'FAILED') {
    const previous = z.object({ serviceManifest: z.object({ deploy: z.object({ limitOverride: z.object({ containers: containerLimits }) }) }) }).safeParse(from.meta);
    const current = await verifyRailwayLimits({ token, config, serviceId });
    // Image reuse also reuses Railway's deployment resource snapshot; a dashboard resize needs a fresh deployment.
    if (deployment || !previous.success || (previous.data.serviceManifest.deploy.limitOverride.containers.cpu === current.cpu && previous.data.serviceManifest.deploy.limitOverride.containers.memoryBytes === current.memoryBytes)) {
      return z.object({ deploymentRedeploy: z.object({ id: z.string() }) }).parse(await railway({ token,
        query: 'mutation($id: String!) { deploymentRedeploy(id: $id, usePreviousImageTag: true) { id } }', variables: { id: from.id },
      })).deploymentRedeploy.id;
    }
  }
  return z.object({ serviceInstanceDeployV2: z.string() }).parse(await railway({ token,
    query: 'mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }',
    variables: { serviceId, environmentId: config.environmentId },
  })).serviceInstanceDeployV2;
}

/** Configure stopped services; preserve permanent service resource settings.
 * Temporary services always run `image`. A permanent slot runs `image` when `source` is 'image' (a pinned digest
 * production already ran, pulled with `registryCredentials`), and otherwise keeps building the repository at its pinned commit.
 * `warm`: an always-on processor slot (railwayWarmSlots), configured to restart on failure.
 * @param {{ token: string, config: ReturnType<typeof railwayConfig>, serviceId: string, image: string, variables: Record<string, string>, registryCredentials?: { username: string, password: string }, source?: 'image' | 'repository', warm?: boolean }} args */
export async function configureRailwaySlot({ token, config, serviceId, image, variables, registryCredentials, source, warm = false }) {
  const instance = await railwayInstance({ token, config, serviceId });
  const registered = [...config.processorServices, ...config.standardServices, ...config.ultraServices].includes(serviceId);
  if (!registered && !instance.serviceName.startsWith(`preflight-${{ production: 'p', dev: 'd' }[config.environment]}-`) && !instance.serviceName.startsWith(`render-${{ production: 'p', dev: 'd' }[config.environment]}-`)) throw new Error('Refusing to configure a service outside the Revline worker namespace.');
  const repository = registered && source !== 'image';
  if (instance.source?.repo && !isRevlineRepository(instance.source.repo)) throw new Error('Refusing to replace another repository.');
  // Switching an image slot back to a repository build is never done here: restores pick the source the slot still has.
  if (repository && !isRevlineRepository(instance.source?.repo)) throw new Error(`Connect the permanent worker to ${REPOSITORY} before staging.`);
  const processor = config.processorServices.includes(serviceId);
  if (warm && !processor) throw new Error('Only processor slots stay running while idle.');
  if (!repository) registryCredentials = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(registryCredentials);
  if (repository) variables = { ...variables, REVLINE_FINAL_TARGET: processor ? 'railway-processor' : 'railway-exports' };
  if (railwayActive(instance)) throw new Error('Drain the Railway service before changing its image or settings.');
  const target = { serviceId, environmentId: config.environmentId };
  if (!registered) z.object({ serviceInstanceLimitsUpdate: z.literal(true) }).parse(await railway({ token, query: 'mutation($input: ServiceInstanceLimitsUpdateInput!) { serviceInstanceLimitsUpdate(input: $input) }', variables: { input: { ...target, ...RAILWAY_BUDGET } } }));
  await verifyRailwayLimits({ token, config, serviceId });
  z.object({ variableCollectionUpsert: z.literal(true) }).parse(await railway({ token, query: 'mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }', variables: { input: { ...target, projectId: config.projectId, variables, replace: true, skipDeploys: true } } }));
  z.object({ serviceInstanceUpdate: z.literal(true) }).parse(await railway({ token, query: 'mutation ConfigureRevlineWorker($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }', variables: { ...target, input: {
    // This environment's instance only (serviceConnect would change the service in every environment). A slot that
    // still reports its repository afterwards fails the check below, before any queue change depends on it.
    ...(!repository ? { source: { image, ...(instance.source?.repo ? { repo: null } : {}) }, registryCredentials } : { dockerfilePath: 'media-processor/Dockerfile' }),
    startCommand: RAILWAY_START_COMMANDS[0], region: config.region,
    numReplicas: 1, ...(warm ? RAILWAY_WARM_RESTART : { restartPolicyType: 'NEVER' }),
    sleepApplication: false, healthcheckPath: null, cronSchedule: null, preDeployCommand: [],
    drainingSeconds: 3000, overlapSeconds: 0,
  } } }));
  await verifyRailwaySlot({ token, config, serviceId, image, source: repository ? 'repository' : 'image' });
}

/** Prove `registryCredentials` can pull `image` from GHCR, the way Railway will, without touching any service.
 * The packages are private: an anonymous pull is refused. Never prints the credentials.
 * @param {{ image: string, registryCredentials: { username?: string, password?: string } }} args */
export async function verifyRegistryPull({ image, registryCredentials }) {
  const match = /^ghcr\.io\/([a-z0-9._/-]+)@(sha256:[a-f0-9]{64})$/.exec(image);
  if (!match) throw new Error(`${image} is not a pinned GHCR image.`);
  const { username, password } = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(registryCredentials);
  const grant = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${match[1]}:pull`, { headers: { authorization: `Basic ${btoa(`${username}:${password}`)}` }, signal: AbortSignal.timeout(30_000) });
  const token = grant.ok ? z.object({ token: z.string().min(1) }).safeParse(await grant.json()) : null;
  if (!token?.success) throw new Error(`The registry credentials cannot pull ${match[1]} (GHCR token HTTP ${grant.status}). Use a GitHub token with read:packages that can read it.`);
  const manifest = await fetch(`https://ghcr.io/v2/${match[1]}/manifests/${match[2]}`, { method: 'HEAD', signal: AbortSignal.timeout(30_000), headers: {
    authorization: `Bearer ${token.data.token}`,
    accept: 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
  } });
  if (!manifest.ok) throw new Error(`${image} cannot be pulled with the registry credentials (HTTP ${manifest.status}).`);
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
  const prefixes = [`preflight-${{ production: 'p', dev: 'd' }[config.environment]}-`, `render-${{ production: 'p', dev: 'd' }[config.environment]}-`];
  let after = null;
  do {
    const result = z.object({ environment: z.object({ serviceInstances: z.object({
      edges: z.array(z.object({ node: z.object({ serviceId: z.string(), serviceName: z.string() }) })),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    }) }) }).parse(await railway({ token,
      query: 'query($id: String!, $after: String) { environment(id: $id) { serviceInstances(first: 100, after: $after) { edges { node { serviceId serviceName } } pageInfo { hasNextPage endCursor } } } }', variables: { id: config.environmentId, after },
    }));
    for (const { node } of result.environment.serviceInstances.edges) {
      const prefix = prefixes.find(value => node.serviceName.startsWith(value));
      const suffix = prefix ? /^(\d{13})-[a-f0-9]{6,8}$/.exec(node.serviceName.slice(prefix.length)) : null;
      if (suffix && Date.now() - Number(suffix[1]) > 55 * 60_000) await deleteRailwayService({ token, config, serviceId: node.serviceId });
    }
    const { hasNextPage, endCursor } = result.environment.serviceInstances.pageInfo;
    if (hasNextPage && (!endCursor || endCursor === after)) throw new Error('Railway service pagination stalled; cleanup held.');
    after = hasNextPage ? endCursor : null;
  } while (after);
}

const logSchema = z.object({ message: z.string(), attributes: z.array(z.object({ key: z.string(), value: z.string() })).default([]) });
const eventSchema = z.object({ event: z.string(), image: z.string().optional(), commit: z.string().optional(), role: z.string().optional(), taskId: z.string().optional(), projectId: z.string().optional(), machines: z.number().optional(), cpus: z.number().optional(), memoryBytes: z.number().optional(), environment: z.string().optional() });
/** Decode both plain renderer traces and Railway's parsed JSON attributes. */
export function railwayLogEvents(raw) {
  return z.array(logSchema).parse(raw).flatMap(log => {
    let fields = Object.fromEntries(log.attributes.map(({ key, value }) => { try { return [key, JSON.parse(value)]; } catch { return [key, value]; } }));
    const start = log.message.indexOf('{');
    if (start >= 0) { try { const parsed = z.record(z.string(), z.unknown()).parse(JSON.parse(log.message.slice(start))); fields = { ...fields, ...parsed }; } catch {} }
    const event = eventSchema.safeParse(fields);
    return event.success ? [event.data] : [];
  });
}
