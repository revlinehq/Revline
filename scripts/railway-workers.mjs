// Explicit operator commands. Nothing in this file runs during install, build or a PR.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { parseArgs, parseEnv } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { z } from 'zod';
import { command, mask } from './release-command.mjs';
import { workerCapacity } from '../lib/worker-capacity.mjs';
import { IMAGE_REGISTRY, REPOSITORY, isRevlineRepository } from '../lib/repository.mjs';
import { verifyStagingPromotion } from './railway-promotion.mjs';
import { removeExpiredRailwayArtifacts } from './render-artifacts.mjs';
import { railwayConfig, railway, railwayLogEvents, verifyRailwayTarget, railwayInstance, railwayActive, configureRailwaySlot, verifyRailwaySlot, deployRailwaySlot, createRailwayService, deleteRailwayService, reapRailwayServices, RAILWAY_CPU_ENV } from '../lib/railway-workers.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  config: { type: 'string' }, environment: { type: 'string' }, 'env-file': { type: 'string' },
  apply: { type: 'boolean' }, kind: { type: 'string', default: 'all' }, 'image-first': { type: 'boolean' },
  processors: { type: 'string' }, standard: { type: 'string' }, ultra: { type: 'string' },
  'artifact-prefix': { type: 'string' }, 'staging-receipt': { type: 'string' }, 'staging-env-file': { type: 'string' },
} });
const [operation] = positionals;
const operations = ['plan', 'build', 'preflight', 'stage-repository', 'provision', 'stage', 'verify', 'cutover', 'rollback', 'pause', 'resume', 'status', 'reap', 'reap-artifacts'];
if (positionals.length !== 1 || !operations.includes(operation) || !values.config || !['dev', 'staging', 'production'].includes(values.environment) || !['all', 'processor', 'exports'].includes(values.kind)) throw new Error(`Usage: node scripts/railway-workers.mjs <${operations.join('|')}> --environment <dev|staging|production> --config <json> [--env-file <selected env>] [--kind processor|exports|all] [--artifact-prefix <attempt prefix>] [--apply]`);
if (values['image-first'] && (operation !== 'stage' || values.kind !== 'processor')) throw new Error('--image-first is only for staging a processor before its immediately following Convex release.');
const configPath = resolve(values.config);
let config = railwayConfig(await readFile(configPath, 'utf8'));
if (config.environment !== values.environment) throw new Error('Explicit environment and manifest differ.');
const deployment = { dev: 'majestic-alpaca-541', staging: 'striped-starling-234', production: 'different-gnu-398' }[config.environment];
const kinds = values.kind === 'all' ? ['processor', 'exports'] : [values.kind];
const selectedPools = () => [
  ...(kinds.includes('processor') ? [{ name: 'processor', ids: config.processorServices, image: config.processorImage }] : []),
  ...(kinds.includes('exports') ? [{ name: 'standard', ids: config.standardServices, image: config.exportsImage }, { name: 'ultra', ids: config.ultraServices, image: config.exportsImage }] : []),
];
const hash = () => createHash('sha256').update(JSON.stringify(config)).digest('hex');
console.log(`Target: Railway ${config.environment}, project ${config.projectId}, environment ${config.environmentId}; Convex ${deployment}. Permanent service CPU and memory limits are managed in the Railway dashboard.`);
if (operation === 'plan' || (!values.apply && operation !== 'status')) {
  console.log(JSON.stringify({ operation, kinds, config, effect: 'No API calls, image builds, resources or environments changed. Pass --apply only after migration authorization.' }, null, 2));
  process.exit(0);
}
// Railway-only image builds and temporary runtime preflights may use the exact
// published PR head. The dedicated isolated staging target may also exercise
// its queue; shared DEV and production queue changes still require main.
if (values.apply) {
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
  const mainPush = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main' && isRevlineRepository(process.env.GITHUB_REPOSITORY) && process.env.GITHUB_SHA === execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const stagingCi = config.environment === 'staging' && process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_WORKFLOW === 'Railway staging' && isRevlineRepository(process.env.GITHUB_REPOSITORY) && process.env.GITHUB_SHA === execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() && gitDir === '.git';
  const railwayOnly = ['build', 'preflight', 'stage-repository'].includes(operation);
  const stagingOperator = config.environment === 'staging' && ['stage', 'verify', 'cutover', 'rollback', 'pause', 'resume', 'status'].includes(operation) && selectedPools().every(pool => pool.ids.length === 1);
  if ((railwayOnly || stagingCi || stagingOperator) && !mainPush && branch !== 'main') {
    const pr = JSON.parse(execFileSync('gh', ['pr', 'view', '--repo', REPOSITORY, '--json', 'headRefOid,headRefName,state'], { encoding: 'utf8' }));
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (pr.state !== 'OPEN' || pr.headRefName !== branch || pr.headRefOid !== head) throw new Error('Pre-merge staging requires the exact published open PR head.');
  } else if (gitDir !== '.git' || (branch !== 'main' && !mainPush && !stagingCi)) throw new Error('Apply queue migration commands only from the primary checkout on reviewed main or its main-push release runner.');
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Migration commands require a clean reviewed checkout; keep local manifests in ignored .data/.');
}
if (config.environment === 'production' && ['stage-repository', 'stage', 'cutover', 'resume'].includes(operation)) await verifyStagingPromotion({ config, receiptFile: values['staging-receipt'], stagingEnvFile: values['staging-env-file'], kinds });
const settings = values['env-file'] ? parseEnv(await readFile(resolve(values['env-file']), 'utf8')) : {};
const env = { ...process.env, ...settings };
mask(env);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

if (operation === 'build') {
  // Build the existing credential-free allow-list context. Explicit target keeps
  // the Cloudflare default Docker stage unchanged.
  await command(process.execPath, ['infra/media-worker/prepare-context.mjs'], { env });
  const context = resolve('.wrangler/media-processor-build');
  const metadata = resolve('.data/railway-build', config.environment);
  await mkdir(metadata, { recursive: true });
  try {
    for (const kind of kinds) {
      const name = kind === 'processor' ? 'processor' : 'exports';
      const tag = `${IMAGE_REGISTRY}/revline-railway-${name}${config.environment === 'dev' ? '-dev' : ''}:${git('rev-parse', 'HEAD')}`;
      const file = join(metadata, `${name}.json`);
      await command('docker', ['buildx', 'build', '--platform', 'linux/amd64', '--target', `railway-${name}`, '--file', 'infra/media-worker/Dockerfile', '--tag', tag, '--build-arg', `REVLINE_BUILD_COMMIT=${git('rev-parse', 'HEAD')}`, '--label', `org.opencontainers.image.source=https://github.com/${REPOSITORY}`, '--metadata-file', file, '--push', '.'], { cwd: context, env });
      const digest = z.object({ 'containerimage.digest': z.string().regex(/^sha256:[a-f0-9]{64}$/) }).parse(JSON.parse(await readFile(file, 'utf8')))['containerimage.digest'];
      config = railwayConfig({ ...config, [`${name}Image`]: `${tag.slice(0, tag.lastIndexOf(':'))}@${digest}`, [`${name}Commit`]: git('rev-parse', 'HEAD') });
      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    }
  } finally { await rm(context, { recursive: true, force: true }); }
  process.exit(0);
}

if (settings.CONVEX_DEPLOYMENT !== `${config.environment === 'dev' ? 'dev' : 'prod'}:${deployment}` || settings.NEXT_PUBLIC_CONVEX_URL !== config.convexUrl) throw new Error('Use a separate environment file for the exact selected Convex deployment.');
const token = settings.RAILWAY_API_TOKEN;
const target = () => ({ token, config });
const registryCredentials = { username: settings.RAILWAY_REGISTRY_USERNAME, password: settings.RAILWAY_REGISTRY_PASSWORD };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
if (operation === 'preflight' || operation === 'stage-repository') {
  await verifyRailwayTarget(target());
  if (operation === 'stage-repository') {
    if (selectedPools().some(pool => pool.ids.length !== 1)) throw new Error('Pre-merge repository staging requires exactly one existing capped service per selected lane.');
    for (const pool of selectedPools()) await preflight(pool.name === 'processor' ? 'processor' : 'exports', pool.ids[0]);
  } else for (const kind of kinds) await preflight(kind);
  console.log('Railway-only runtime preflight complete. No Convex access, queue credentials, staging receipt or routing changes.');
  process.exit(0);
}
if (!settings.CONVEX_DEPLOY_KEY) delete env.CONVEX_DEPLOY_KEY;
if (env.CONVEX_DEPLOY_KEY && !env.CONVEX_DEPLOY_KEY.startsWith(`prod:${deployment}|`)) throw new Error('Convex deploy key belongs to another deployment.');
const convex = (args, input) => command(process.execPath, ['node_modules/convex/bin/main.js', ...args, ...(env.CONVEX_DEPLOY_KEY ? [] : ['--deployment', deployment])], { env, input, quiet: true });
const remote = parseEnv(await convex(['env', 'list']));
mask(remote);
if (config.environment === 'staging' && remote.REVLINE_ISOLATED !== 'true') throw new Error('Staging queue operations require the dedicated isolated backend.');
// Recovery must still be able to restore Convex routes during a Railway outage.
if (!['rollback', 'pause'].includes(operation)) await verifyRailwayTarget(target());
const setEnv = (name, value) => convex(['env', 'set', name], value);
const client = new ConvexHttpClient(config.convexUrl);
const contract = await client.query(makeFunctionReference('railwayWorkers:contract'), { workerSecret: remote.RENDER_WORKER_SECRET });
const sourceVersion = Number(/MEDIA_PROCESSOR_VERSION\s*=\s*(\d+)/.exec(await readFile('lib/media-analysis/processor-version.ts', 'utf8'))?.[1]);
if (['stage', 'verify', 'cutover'].includes(operation) && (values['image-first'] ? contract.processorVersion > sourceVersion : contract.processorVersion !== sourceVersion)) throw new Error('Deploy the matching Convex worker contract before cutover.');
const dispatch = () => convex(['run', 'railwayWorkers:dispatch', '{}']);
const caps = workerCapacity(remote);
for (const pool of selectedPools()) if (!Number.isInteger(caps[pool.name]) || pool.ids.length > caps[pool.name]) throw new Error(`${pool.name}: Railway pool exceeds the configured worker capacity; review capacity separately.`);

async function waitStopped() {
  const deadline = Date.now() + 50 * 60_000;
  while (true) {
    let busy = false;
    for (const { ids } of selectedPools()) for (const serviceId of ids) if (railwayActive(await railwayInstance({ ...target(), serviceId }))) busy = true;
    if (!busy) return;
    if (Date.now() > deadline) throw new Error('Workers did not drain; queue remains paused. No running service was replaced.');
    await wait(15_000);
  }
}

async function preflight(kind, existingServiceId) {
  const image = kind === 'processor' ? config.processorImage : config.exportsImage;
  const serviceId = existingServiceId || await createRailwayService({ ...target(), name: `preflight-${{ production: 'p', staging: 's', dev: 'd' }[config.environment]}-${Date.now()}-${randomUUID().slice(0, 6)}` });
  try {
    await configureRailwaySlot({ ...target(), serviceId, image, registryCredentials, variables: {
      ...RAILWAY_CPU_ENV, NEXT_PUBLIC_CONVEX_URL: config.convexUrl, RAILWAY_WORKERS_JSON: JSON.stringify(config),
      MEDIA_WORKER_CONCURRENCY: '1', REVLINE_RAILWAY_MODE: 'preflight', REVLINE_RAILWAY_IMAGE: image,
    } });
    const id = await deployRailwaySlot({ ...target(), serviceId });
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const result = z.object({ deployment: z.object({ status: z.string(), deploymentStopped: z.boolean() }), deploymentLogs: z.unknown() }).parse(await railway({ token,
        query: 'query($id: String!) { deployment(id: $id) { status deploymentStopped } deploymentLogs(deploymentId: $id, limit: 500) { message attributes { key value } } }', variables: { id },
      }));
      if (['FAILED', 'CRASHED', 'REMOVED'].includes(result.deployment.status)) throw new Error(`${kind}: Railway runtime preflight failed; dispatch unchanged.`);
      const verified = railwayLogEvents(result.deploymentLogs).some(event => event.event === 'railway-runtime-verified' && event.image === image && event.commit === config[kind === 'processor' ? 'processorCommit' : 'exportsCommit'] && event.role === kind);
      if (verified && result.deployment.deploymentStopped) { console.log(`Verified ${kind} runtime on Railway: ${image}. No queue connection or media/model task.`); return; }
      await wait(10_000);
    }
    throw new Error(`${kind}: runtime preflight timed out; dispatch unchanged.`);
  } finally { if (!existingServiceId) await deleteRailwayService({ ...target(), serviceId }); }
}

async function verifyQueueConnection(serviceId) {
  const id = await deployRailwaySlot({ ...target(), serviceId });
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const result = z.object({ deployment: z.object({ status: z.string(), deploymentStopped: z.boolean() }), deploymentLogs: z.unknown() }).parse(await railway({ token,
      query: 'query($id: String!) { deployment(id: $id) { status deploymentStopped } deploymentLogs(deploymentId: $id, limit: 500) { message attributes { key value } } }', variables: { id },
    }));
    const events = railwayLogEvents(result.deploymentLogs);
    if (events.some(event => event.event === 'media-started')) throw new Error('A staged worker claimed a task while paused. Hold cutover and inspect queue routing.');
    if (['FAILED', 'CRASHED', 'REMOVED'].includes(result.deployment.status)) throw new Error('Railway staged consumer failed; queue remains paused.');
    if (events.some(event => event.event === 'railway-queue-verified') && events.some(event => event.event === 'media-ready') && result.deployment.deploymentStopped) return;
    await wait(10_000);
  }
  throw new Error('Staged consumer did not authenticate and exit idle; queue remains paused.');
}

if (operation === 'status') {
  console.log(JSON.stringify({ contract, pools: await Promise.all(selectedPools().map(async pool => ({ name: pool.name, slots: await Promise.all(pool.ids.map(serviceId => railwayInstance({ ...target(), serviceId }))) }))) }, null, 2));
} else if (operation === 'provision') {
  for (const pool of selectedPools()) {
    const count = Number(values[pool.name === 'processor' ? 'processors' : pool.name]);
    if (!Number.isInteger(count) || count < pool.ids.length || count > caps[pool.name]) throw new Error(`Specify an explicit ${pool.name} slot count within existing capacity. This command never removes slots.`);
    while (pool.ids.length < count) {
      const serviceId = await createRailwayService({ ...target(), name: `revline-${config.environment}-${pool.name}-${pool.ids.length + 1}` });
      pool.ids.push(serviceId);
      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    }
  }
} else if (operation === 'verify') {
  if (!values.apply) throw new Error('Runtime verification creates temporary preflight services; use --apply after authorization. Use status for read-only inspection.');
  for (const pool of selectedPools()) for (const serviceId of pool.ids) await preflight(pool.name === 'processor' ? 'processor' : 'exports', serviceId);
  // Only distributed chunks pull immutable registry images. The permanent
  // services run the repository builds just verified above.
  if (kinds.includes('exports') && config.distributedExports) await preflight('exports');
  for (const pool of selectedPools()) for (const serviceId of pool.ids) await verifyRailwaySlot({ ...target(), serviceId, image: pool.image });
} else if (operation === 'stage') {
  const artifactVariables = {};
  const maxChunks = z.coerce.number().int().min(2).max(16).parse(settings.REVLINE_EXPORT_MAX_CHUNKS ?? 8);
  if (kinds.includes('exports') && config.distributedExports) {
    for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_ENDPOINT_URL_S3', 'BUCKET_NAME']) {
      if (!settings[name]) throw new Error(`${name} for the selected environment’s existing artifact bucket is required. No bucket migration or cross-environment credential lookup is performed.`);
      artifactVariables[name] = settings[name];
    }
    if (settings.AWS_REGION) artifactVariables.AWS_REGION = settings.AWS_REGION;
    if (settings.BUCKET_NAME !== config.artifactBucket || settings.AWS_ENDPOINT_URL_S3 !== config.artifactEndpoint) throw new Error('Artifact credentials/endpoint do not match the selected environment manifest.');
  }
  for (const pool of selectedPools()) for (const serviceId of pool.ids) await preflight(pool.name === 'processor' ? 'processor' : 'exports', serviceId);
  if (kinds.includes('exports') && config.distributedExports) await preflight('exports');
  await setEnv('RAILWAY_WORKERS_PAUSED', 'true');
  await waitStopped();
  for (const pool of selectedPools()) for (const serviceId of pool.ids) {
    const exportsOnly = pool.name !== 'processor';
    const secret = remote[exportsOnly ? 'MEDIA_WORKER_SECRET_EXPORTS' : 'RENDER_WORKER_SECRET'];
    if (!secret || !remote.MEDIA_WORKER_URL) throw new Error('Selected deployment lacks worker/media credentials.');
    const variables = {
      ...RAILWAY_CPU_ENV, NEXT_PUBLIC_CONVEX_URL: config.convexUrl, RAILWAY_WORKERS_JSON: JSON.stringify(config),
      RENDER_WORKER_SECRET: secret, MEDIA_WORKER_URL: remote.MEDIA_WORKER_URL, REVLINE_RAILWAY_IMAGE: pool.image,
      MEDIA_WORKER_CONCURRENCY: '1', MEDIA_WORKER_IDLE_MS: '60000', MEDIA_TASK_DEADLINE_MS: String(45 * 60_000),
      ...(exportsOnly ? { MEDIA_RENDERS_ONLY: 'true', ...(pool.name === 'ultra' ? { MEDIA_LANE: 'ultra' } : {}) } : { MEDIA_PROCESSOR_BACKEND: 'railway' }),
      ...(exportsOnly && config.distributedExports ? { ...artifactVariables, RAILWAY_API_TOKEN: token, RAILWAY_REGISTRY_USERNAME: settings.RAILWAY_REGISTRY_USERNAME, RAILWAY_REGISTRY_PASSWORD: settings.RAILWAY_REGISTRY_PASSWORD, REVLINE_DISTRIBUTED_EXPORT: 'true', REVLINE_EXPORT_MAX_CHUNKS: String(maxChunks), PRODUCER_FORCE_SCREENSHOT: 'false', REVLINE_RENDER_LOG_LEVEL: 'info' } : {}),
    };
    if (!exportsOnly) for (const name of ['DEEPGRAM_API_KEY', 'FAL_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_VIDEO_MODEL', 'GEMINI_FRAME_MODEL', 'MEDIA_VISION_GEMINI_FALLBACK']) {
      const value = settings[name] || remote[name];
      if (value) variables[name] = value;
      else if (name.endsWith('_KEY')) throw new Error(`Selected environment lacks ${name}.`);
    }
    // Optional: SAM 3.1 (Meta) for MCP subject selections; those requests fail clearly when it is unset.
    if (!exportsOnly && (settings.MODEL_API_KEY || remote.MODEL_API_KEY)) variables.MODEL_API_KEY = settings.MODEL_API_KEY || remote.MODEL_API_KEY;
    await configureRailwaySlot({ ...target(), serviceId, image: pool.image, variables });
  }
  await setEnv('RAILWAY_API_TOKEN', token);
  await setEnv('RAILWAY_WORKERS_JSON', JSON.stringify(config));
  // Verify the real consumer/credentials of each lane while the backend forbids
  // claims, then let it exit at idle before releasing the hold.
  for (const pool of selectedPools()) if (pool.ids[0]) await verifyQueueConnection(pool.ids[0]);
  await writeFile(`${configPath}.verified.json`, JSON.stringify({ hash: hash(), kinds, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
  await setEnv('RAILWAY_WORKERS_PAUSED', String(contract.paused));
  await dispatch();
  console.log('Railway artifacts staged and runtime verified. Processor backend and export provider unchanged.');
} else if (operation === 'cutover') {
  if ((kinds.includes('processor') && contract.processorBackend === 'railway') || (kinds.includes('exports') && contract.renderProvider === 'railway')) throw new Error('A selected role already uses Railway. Use stage for releases; cut over only unmigrated roles.');
    const receipt = z.object({ hash: z.string(), kinds: z.array(z.enum(['processor', 'exports'])), at: z.string().datetime() }).parse(JSON.parse(await readFile(`${configPath}.verified.json`, 'utf8')));
  if (receipt.hash !== hash() || kinds.some(kind => !receipt.kinds.includes(kind)) || remote.RAILWAY_WORKERS_JSON !== JSON.stringify(config) || token !== remote.RAILWAY_API_TOKEN) throw new Error('Stage and verify this exact configuration/token before cutover.');
  if (contract.paused) throw new Error('Railway dispatch is paused; resolve the hold before cutover.');
  for (const pool of selectedPools()) {
    if (!pool.ids.length && caps[pool.name] > 0) throw new Error(`${pool.name}: no Railway slots provisioned.`);
    for (const serviceId of pool.ids) await verifyRailwaySlot({ ...target(), serviceId, image: pool.image });
  }
  const rollback = { environment: config.environment, projectId: config.projectId, environmentId: config.environmentId, kinds,
    processorBackend: contract.processorBackend, renderProvider: contract.renderProvider };
  // Save before the first switch, so a partial cutover can always be reversed.
  await writeFile(`${configPath}.rollback.json`, JSON.stringify(rollback, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (kinds.includes('processor')) await setEnv('MEDIA_PROCESSOR_BACKEND', 'railway');
  if (kinds.includes('exports')) await setEnv('RENDER_PROVIDER', 'railway');
  await dispatch();
  console.log('Railway queue dispatch selected. Existing task leases finish normally.');
} else if (operation === 'rollback') {
  const previous = z.object({ environment: z.literal(config.environment), projectId: z.literal(config.projectId), environmentId: z.literal(config.environmentId), kinds: z.array(z.enum(['processor', 'exports'])), processorBackend: z.enum(['local', 'cloudflare', 'railway']), renderProvider: z.enum(['', 'local', 'cloudflare', 'railway']) }).parse(JSON.parse(await readFile(`${configPath}.rollback.json`, 'utf8')));
  await setEnv('RAILWAY_WORKERS_PAUSED', 'true');
  if (previous.kinds.includes('processor')) await setEnv('MEDIA_PROCESSOR_BACKEND', previous.processorBackend);
  if (previous.kinds.includes('exports')) {
    if (previous.renderProvider) await setEnv('RENDER_PROVIDER', previous.renderProvider);
    else await convex(['env', 'remove', 'RENDER_PROVIDER']);
  }
  if (previous.processorBackend === 'railway' || previous.renderProvider === 'railway') {
    await setEnv('RAILWAY_WORKERS_PAUSED', 'false');
    await dispatch();
  }
  console.log('Previous routes restored. Railway tasks retain their leases and drain.');
} else if (operation === 'pause' || operation === 'resume') {
  if (operation === 'resume' && (remote.RAILWAY_WORKERS_JSON !== JSON.stringify(config) || token !== remote.RAILWAY_API_TOKEN)) throw new Error('Resume requires the exact staged manifest and token.');
  await setEnv('RAILWAY_WORKERS_PAUSED', String(operation === 'pause'));
  if (operation === 'pause') await waitStopped(); else await dispatch();
} else if (operation === 'reap') await reapRailwayServices(target());
else if (operation === 'reap-artifacts') {
  if (!contract.paused || values.kind !== 'all') throw new Error('Pause all Railway slots before orphan artifact recovery.');
  if (!config.distributedExports || settings.BUCKET_NAME !== config.artifactBucket || settings.AWS_ENDPOINT_URL_S3 !== config.artifactEndpoint) throw new Error('Use the selected environment’s existing artifact storage credentials.');
  await waitStopped();
  await reapRailwayServices(target());
  // render-artifacts reads only the explicitly selected storage settings.
  for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_ENDPOINT_URL_S3', 'BUCKET_NAME', 'AWS_REGION']) {
    if (settings[name]) process.env[name] = settings[name]; else delete process.env[name];
  }
  console.log(`Removed ${await removeExpiredRailwayArtifacts(values['artifact-prefix'] || '')} expired artifact objects.`);
}
