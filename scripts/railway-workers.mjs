// Explicit operator commands. Nothing in this file runs during install, build or a PR.
// Permanent slots deploy from GitHub main (Railway autodeploy) and no release stages them. `stage` remains for one
// thing: rolling a lane back to a pinned registry image (docs/releases.md, Rollback). `stage-repository` and `verify`
// ran preflights on permanent slots and are retired: a preflight deployment left on a slot was what a later start
// redeployed, and it exited at once instead of serving.
import { readFile, writeFile, appendFile, mkdir, rm } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { parseArgs, parseEnv } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { z } from 'zod';
import { command, mask } from './release-command.mjs';
import { workerCapacity, alwaysOnProcessors } from '../lib/worker-capacity.mjs';
import { IMAGE_REGISTRY, REPOSITORY, isRevlineRepository } from '../lib/repository.mjs';
import { verifyStagingPromotion, founderBypassReason, recordProductionStage } from './railway-promotion.mjs';
import { removeExpiredRailwayArtifacts } from './render-artifacts.mjs';
import { railwayConfig, railway, railwayLogEvents, verifyRailwayTarget, railwayInstance, railwayActive, configureRailwaySlot, verifyRailwaySlot, deployRailwaySlot, createRailwayService, deleteRailwayService, reapRailwayServices, railwaySlotSource, verifyRegistryPull, railwayWarmSlots, RAILWAY_CPU_ENV } from '../lib/railway-workers.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  config: { type: 'string' }, environment: { type: 'string' }, 'env-file': { type: 'string' },
  apply: { type: 'boolean' }, kind: { type: 'string', default: 'all' }, 'image-first': { type: 'boolean' },
  processors: { type: 'string' }, standard: { type: 'string' }, ultra: { type: 'string' },
  'artifact-prefix': { type: 'string' }, 'staging-receipt': { type: 'string' }, 'staging-env-file': { type: 'string' }, 'founder-bypass': { type: 'string' },
} });
const [operation] = positionals;
const operations = ['plan', 'check', 'build', 'preflight', 'stage-repository', 'provision', 'stage', 'verify', 'cutover', 'rollback', 'pause', 'resume', 'status', 'reap', 'reap-artifacts'];
if (positionals.length !== 1 || !operations.includes(operation) || !values.config || !['dev', 'staging', 'production'].includes(values.environment) || !['all', 'processor', 'exports'].includes(values.kind)) throw new Error(`Usage: node scripts/railway-workers.mjs <${operations.join('|')}> --environment <dev|staging|production> --config <json> [--env-file <selected env>] [--kind processor|exports|all] [--artifact-prefix <attempt prefix>] [--founder-bypass "<reason>" (production stage only)] [--apply]`);
if (values['image-first'] && (operation !== 'stage' || values.kind !== 'processor')) throw new Error('--image-first is only for staging a processor before its immediately following Convex release.');
// A founder-approved exception to the staging receipt, for one production `stage` run. It is never implied:
// the reason is required, it cannot be combined with a receipt, and the run is logged before anything changes.
let founderBypass;
if (values['founder-bypass'] !== undefined) {
  if (operation !== 'stage' || values.environment !== 'production') throw new Error('--founder-bypass applies only to `stage --environment production`.');
  founderBypass = founderBypassReason(values['founder-bypass']);
  if (values['staging-receipt']) throw new Error('Pass a staging receipt or --founder-bypass, not both.');
}
const configPath = resolve(values.config);
let config = railwayConfig(await readFile(configPath, 'utf8'));
if (config.environment !== values.environment) throw new Error('Explicit environment and manifest differ.');
const deployment = { dev: 'majestic-alpaca-541', staging: 'striped-starling-234', production: 'different-gnu-398' }[config.environment];
const kinds = values.kind === 'all' ? ['processor', 'exports'] : [values.kind];
if (['stage-repository', 'verify'].includes(operation)) throw new Error(`${operation} is retired: permanent slots deploy from GitHub main. See docs/releases.md (Railway).`);
// A pinned-image operation needs the pins of every kind it touches.
if (['preflight', 'stage', 'check', 'cutover', 'resume'].includes(operation)) for (const kind of kinds) if (!config[`${kind}Image`] || !config[`${kind}Commit`]) throw new Error(`${operation} --kind ${kind} needs ${kind}Image and ${kind}Commit pinned in ${values.config}.`);
const selectedPools = () => [
  ...(kinds.includes('processor') ? [{ name: 'processor', ids: config.processorServices, image: config.processorImage }] : []),
  ...(kinds.includes('exports') ? [{ name: 'standard', ids: config.standardServices, image: config.exportsImage }, { name: 'ultra', ids: config.ultraServices, image: config.exportsImage }] : []),
];
const hash = () => createHash('sha256').update(JSON.stringify(config)).digest('hex');
console.log(`Target: Railway ${config.environment}, project ${config.projectId}, environment ${config.environmentId}; Convex ${deployment}. Permanent service CPU and memory limits are managed in the Railway dashboard.`);
if (operation === 'plan' || (!values.apply && !['status', 'check'].includes(operation))) {
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
  const railwayOnly = ['build', 'preflight'].includes(operation);
  const stagingOperator = config.environment === 'staging' && ['stage', 'verify', 'cutover', 'rollback', 'pause', 'resume', 'status'].includes(operation) && selectedPools().every(pool => pool.ids.length === 1);
  if ((railwayOnly || stagingCi || stagingOperator) && !mainPush && branch !== 'main') {
    const pr = JSON.parse(execFileSync('gh', ['pr', 'view', '--repo', REPOSITORY, '--json', 'headRefOid,headRefName,state'], { encoding: 'utf8' }));
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (pr.state !== 'OPEN' || pr.headRefName !== branch || pr.headRefOid !== head) throw new Error('Pre-merge staging requires the exact published open PR head.');
  } else if (gitDir !== '.git' || (branch !== 'main' && !mainPush && !stagingCi)) throw new Error('Apply queue migration commands only from the primary checkout on reviewed main or its main-push release runner.');
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Migration commands require a clean reviewed checkout; keep local manifests in ignored .data/.');
}
if (founderBypass) {
  const gitValue = name => { try { return execFileSync('git', ['config', name], { encoding: 'utf8' }).trim(); } catch { return ''; } };
  const entry = { at: new Date().toISOString(), osUser: userInfo().username, host: hostname(), gitName: gitValue('user.name'), gitEmail: gitValue('user.email'), reason: founderBypass,
    environment: config.environment, operation, kinds, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), processorCommit: config.processorCommit, exportsCommit: config.exportsCommit, manifestHash: hash() };
  const log = resolve('.data/railway/founder-bypass.log');
  // No log, no bypass: a failure here throws before any Railway or Convex call.
  await mkdir(resolve('.data/railway'), { recursive: true });
  await appendFile(log, JSON.stringify(entry) + '\n', { mode: 0o600 });
  console.log(`\n*** FOUNDER BYPASS: staging promotion receipt NOT checked for this production stage. Reason: ${founderBypass}. Logged to ${log}. ***\n`);
} else if (config.environment === 'production' && ['stage', 'cutover', 'resume'].includes(operation)) await verifyStagingPromotion({ config, receiptFile: values['staging-receipt'], stagingEnvFile: values['staging-env-file'], kinds, recorded: true });
const settings = values['env-file'] ? parseEnv(await readFile(resolve(values['env-file']), 'utf8')) : {};
const env = { ...process.env, ...settings };
mask(env);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

if (operation === 'build') {
  // Build the existing credential-free allow-list context. Explicit target keeps
  // the Cloudflare default Docker stage unchanged.
  await command(process.execPath, ['media-processor/prepare-context.mjs'], { env });
  const context = resolve('.wrangler/media-processor-build');
  const metadata = resolve('.data/railway-build', config.environment);
  await mkdir(metadata, { recursive: true });
  try {
    for (const kind of kinds) {
      const name = kind === 'processor' ? 'processor' : 'exports';
      const tag = `${IMAGE_REGISTRY}/revline-railway-${name}${config.environment === 'dev' ? '-dev' : ''}:${git('rev-parse', 'HEAD')}`;
      const file = join(metadata, `${name}.json`);
      await command('docker', ['buildx', 'build', '--platform', 'linux/amd64', '--target', `railway-${name}`, '--file', 'media-processor/Dockerfile', '--tag', tag, '--build-arg', `REVLINE_BUILD_COMMIT=${git('rev-parse', 'HEAD')}`, '--label', `org.opencontainers.image.source=https://github.com/${REPOSITORY}`, '--metadata-file', file, '--push', '.'], { cwd: context, env });
      const digest = z.object({ 'containerimage.digest': z.string().regex(/^sha256:[a-f0-9]{64}$/) }).parse(JSON.parse(await readFile(file, 'utf8')))['containerimage.digest'];
      config = railwayConfig({ ...config, [`${name}Image`]: `${tag.slice(0, tag.lastIndexOf(':'))}@${digest}`, [`${name}Commit`]: git('rev-parse', 'HEAD') });
      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    }
  } finally { await rm(context, { recursive: true, force: true }); }
  process.exit(0);
}

if (settings.CONVEX_DEPLOYMENT !== `${config.environment === 'dev' ? 'dev' : 'prod'}:${deployment}` || settings.NEXT_PUBLIC_CONVEX_URL !== config.convexUrl) throw new Error('Use a separate environment file for the exact selected Convex deployment.');
const token = settings.RAILWAY_API_TOKEN;
if (!token && ['stage', 'check'].includes(operation)) throw new Error(`RAILWAY_API_TOKEN (the ${config.environment} environment project token) is not set in ${values['env-file']}.`);
const target = () => ({ token, config });
const registryCredentials = { username: settings.RAILWAY_REGISTRY_USERNAME, password: settings.RAILWAY_REGISTRY_PASSWORD };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
if (operation === 'preflight') {
  await verifyRailwayTarget(target());
  for (const kind of kinds) await preflight(kind);
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
/** RAILWAY_WORKERS_JSON as the deployment holds it now (not the copy read at startup). */
const liveManifest = async () => { const live = parseEnv(await convex(['env', 'list'])); mask(live); return live.RAILWAY_WORKERS_JSON; };
const KIND_FIELDS = { processor: ['processorImage', 'processorCommit', 'processorServices'], exports: ['exportsImage', 'exportsCommit', 'standardServices', 'ultraServices', 'distributedExports', 'artifactBucket', 'artifactEndpoint'] };
/** `live` with only `stagedKinds`' entries taken from `staged`. */
const withKinds = (live, staged, stagedKinds) => {
  const merged = { ...staged };
  for (const [kind, fields] of Object.entries(KIND_FIELDS)) if (!stagedKinds.includes(kind)) for (const field of fields) {
    if (live[field] === undefined) delete merged[field]; else merged[field] = live[field];
  }
  return railwayConfig(merged);
};
/** Reads the manifest back and fails unless both kinds are exactly `expected`. */
const expectManifest = async (expected, what) => {
  const raw = await liveManifest();
  let live = null;
  try { live = railwayConfig(raw); } catch { live = null; }
  const describe = manifest => manifest ? `processor ${manifest.processorCommit?.slice(0, 7)} ${manifest.processorImage?.split('@')[1]?.slice(7, 19)}, exports ${manifest.exportsCommit?.slice(0, 7)} ${manifest.exportsImage?.split('@')[1]?.slice(7, 19)}` : 'unreadable';
  if (!live || JSON.stringify(live) !== JSON.stringify(railwayConfig(expected))) throw new Error(`${deployment} RAILWAY_WORKERS_JSON read back after it was ${what} is ${describe(live)}; expected ${describe(railwayConfig(expected))}.`);
  console.log(`${deployment} RAILWAY_WORKERS_JSON ${what} and read back: ${describe(live)}.`);
};
const client = new ConvexHttpClient(config.convexUrl);
const contract = await client.query(makeFunctionReference('railwayWorkers:contract'), { workerSecret: remote.RENDER_WORKER_SECRET });
const sourceVersion = Number(/MEDIA_PROCESSOR_VERSION\s*=\s*(\d+)/.exec(await readFile('lib/media-analysis/processor-version.ts', 'utf8'))?.[1]);
// `check` runs before this release's Convex deploy, so only a processor older than the backend's contract fails it.
if (operation === 'check' && contract.processorVersion > sourceVersion) throw new Error('Production Convex expects a newer processor contract than this commit.');
if (['stage', 'verify', 'cutover'].includes(operation) && (values['image-first'] ? contract.processorVersion > sourceVersion : contract.processorVersion !== sourceVersion)) throw new Error('Deploy the matching Convex worker contract before cutover.');
const dispatch = () => convex(['run', 'railwayWorkers:dispatch', '{}']);
const caps = workerCapacity(remote);
/** Whether a slot is one of the deployment's always-on processor slots (MEDIA_PROCESSOR_ALWAYS_ON): it keeps its
 *  restart-on-failure policy through a stage. */
const warm = (serviceId, manifest = config) => railwayWarmSlots(manifest, alwaysOnProcessors(remote)).includes(serviceId);
for (const pool of selectedPools()) if (!Number.isInteger(caps[pool.name]) || pool.ids.length > caps[pool.name]) throw new Error(`${pool.name}: Railway pool exceeds the configured worker capacity; review capacity separately.`);

async function waitStopped(limitMs = 50 * 60_000, pools = selectedPools()) {
  const deadline = Date.now() + limitMs;
  while (true) {
    let busy = false;
    for (const { ids } of pools) for (const serviceId of ids) if (railwayActive(await railwayInstance({ ...target(), serviceId }))) busy = true;
    if (!busy) return;
    if (Date.now() > deadline) throw new Error('Workers did not drain; queue remains paused. No running service was replaced.');
    await wait(15_000);
  }
}

async function preflight(kind, existingServiceId) {
  const image = kind === 'processor' ? config.processorImage : config.exportsImage;
  const serviceId = existingServiceId || await createRailwayService({ ...target(), name: `preflight-${{ production: 'p', staging: 's', dev: 'd' }[config.environment]}-${Date.now()}-${randomUUID().slice(0, 6)}` });
  try {
    // A permanent slot is checked with the source it already has; a temporary service always runs the image.
    const source = existingServiceId && railwaySlotSource(await railwayInstance({ ...target(), serviceId })) === 'image' ? 'image' : undefined;
    await configureRailwaySlot({ ...target(), serviceId, image, registryCredentials, source, warm: !!existingServiceId && warm(serviceId), variables: {
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

async function verifyQueueConnection(serviceId, lane = 'staged') {
  const id = await deployRailwaySlot({ ...target(), serviceId });
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const result = z.object({ deployment: z.object({ status: z.string(), deploymentStopped: z.boolean() }), deploymentLogs: z.unknown() }).parse(await railway({ token,
      query: 'query($id: String!) { deployment(id: $id) { status deploymentStopped } deploymentLogs(deploymentId: $id, limit: 500) { message attributes { key value } } }', variables: { id },
    }));
    const events = railwayLogEvents(result.deploymentLogs);
    if (events.some(event => event.event === 'media-started')) throw new Error('A staged worker claimed a task while paused. Hold cutover and inspect queue routing.');
    if (['FAILED', 'CRASHED', 'REMOVED'].includes(result.deployment.status)) {
      const revision = JSON.stringify(result.deploymentLogs).includes('Railway build revision differs');
      throw new Error(`Railway ${lane} consumer ${serviceId} failed to boot${revision ? ': its build revision differs from the manifest (RAILWAY_WORKERS_JSON) it would be started with' : ''}; queue remains paused.`);
    }
    if (events.some(event => event.event === 'railway-queue-verified') && events.some(event => event.event === 'media-ready') && result.deployment.deploymentStopped) return;
    await wait(10_000);
  }
  throw new Error(`Railway ${lane} consumer ${serviceId} did not authenticate and exit idle; queue remains paused.`);
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
} else if (operation === 'stage' || operation === 'check') {
  // ---- 1. Every check, before any claim pause or slot change ----
  // Anything a release can be missing (a key, the project token, registry access, an image) fails here, while
  // production still runs and claims. `check` stops after this block; release:prod runs it before the staging proof.
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
  /** The variables one slot of `manifest` runs with. Throws on a missing value. */
  const slotVariables = (manifest, poolName) => {
    const exportsOnly = poolName !== 'processor';
    const secret = remote[exportsOnly ? 'MEDIA_WORKER_SECRET_EXPORTS' : 'RENDER_WORKER_SECRET'];
    if (!secret || !remote.MEDIA_WORKER_URL) throw new Error(`Selected deployment lacks ${!secret ? (exportsOnly ? 'MEDIA_WORKER_SECRET_EXPORTS' : 'RENDER_WORKER_SECRET') : 'MEDIA_WORKER_URL'}.`);
    const variables = {
      ...RAILWAY_CPU_ENV, NEXT_PUBLIC_CONVEX_URL: manifest.convexUrl, RAILWAY_WORKERS_JSON: JSON.stringify(manifest),
      RENDER_WORKER_SECRET: secret, MEDIA_WORKER_URL: remote.MEDIA_WORKER_URL, REVLINE_RAILWAY_IMAGE: exportsOnly ? manifest.exportsImage : manifest.processorImage,
      MEDIA_WORKER_CONCURRENCY: '1', MEDIA_WORKER_IDLE_MS: '60000', MEDIA_TASK_DEADLINE_MS: String(45 * 60_000),
      ...(exportsOnly ? { MEDIA_RENDERS_ONLY: 'true', ...(poolName === 'ultra' ? { MEDIA_LANE: 'ultra' } : {}) } : { MEDIA_PROCESSOR_BACKEND: 'railway' }),
      ...(exportsOnly && manifest.distributedExports ? { ...artifactVariables, RAILWAY_API_TOKEN: token, RAILWAY_REGISTRY_USERNAME: settings.RAILWAY_REGISTRY_USERNAME, RAILWAY_REGISTRY_PASSWORD: settings.RAILWAY_REGISTRY_PASSWORD, REVLINE_DISTRIBUTED_EXPORT: 'true', REVLINE_EXPORT_MAX_CHUNKS: String(maxChunks), PRODUCER_FORCE_SCREENSHOT: 'false', REVLINE_RENDER_LOG_LEVEL: 'info' } : {}),
    };
    if (!exportsOnly) for (const name of ['DEEPGRAM_API_KEY', 'FAL_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_VIDEO_MODEL', 'GEMINI_FRAME_MODEL', 'MEDIA_VISION_GEMINI_FALLBACK', 'VIDEO_IMPORT_PROXY']) {
      const value = settings[name] || remote[name];
      if (value) variables[name] = value;
      else if (name.endsWith('_KEY')) throw new Error(`Selected environment lacks ${name} (set it in ${values['env-file'] ?? 'the Railway env file'} or the deployment's Convex environment).`);
    }
    return variables;
  };
  // Staged images replace repository builds once the backend's dispatcher can start image slots and the registry
  // credentials exist. Otherwise the slots keep building the commit from the repository, as before.
  const hasRegistry = !!(settings.RAILWAY_REGISTRY_USERNAME && settings.RAILWAY_REGISTRY_PASSWORD);
  if (!hasRegistry && (settings.RAILWAY_REGISTRY_USERNAME || settings.RAILWAY_REGISTRY_PASSWORD)) throw new Error('Set both RAILWAY_REGISTRY_USERNAME and RAILWAY_REGISTRY_PASSWORD, or neither.');
  // Only pinned registry images are staged; a repository slot switched to one stops following main until its source is
  // set back to the repository in Railway (docs/releases.md, Rollback).
  const imageSlots = contract.imageSlots === true && hasRegistry;
  if (!imageSlots) throw new Error(`A pinned-image stage needs ${contract.imageSlots !== true ? `${deployment}'s Convex to report image slots` : `RAILWAY_REGISTRY_USERNAME/RAILWAY_REGISTRY_PASSWORD in ${values['env-file']}`}. Otherwise roll back in Railway: redeploy an earlier deployment of the slot, or revert on main.`);
  // The manifest this deployment runs now is the restore point if anything fails after the pause.
  let previous = null;
  try { previous = remote.RAILWAY_WORKERS_JSON ? railwayConfig(remote.RAILWAY_WORKERS_JSON) : null; } catch { previous = null; }
  if (previous && (previous.environment !== config.environment || previous.environmentId !== config.environmentId)) previous = null;
  // A stage of one kind changes only that kind's entry of the manifest production runs now; the other kind's entry is
  // the live one, never the copy in --config (a stale copy put the old processor back on 2026-11-13).
  if (kinds.length === 1) {
    if (remote.RAILWAY_WORKERS_JSON && !previous) throw new Error(`${deployment}'s live RAILWAY_WORKERS_JSON cannot be read for this environment; a ${kinds[0]} stage cannot tell what the other kind runs. Stage --kind all.`);
    if (previous) {
      const other = kinds[0] === 'processor' ? 'exports' : 'processor';
      if (config[`${other}Commit`] !== previous[`${other}Commit`] || config[`${other}Image`] !== previous[`${other}Image`]) console.log(`Keeping the live ${other} entry ${previous[`${other}Commit`]?.slice(0, 7)} (${values.config} has ${config[`${other}Commit`]?.slice(0, 7)}; a ${kinds[0]} stage does not change it).`);
      config = withKinds(previous, config, kinds);
    }
  }
  // The previous manifest is a restore point only when it pins every staged kind; slots that follow main have no pin.
  const restorable = !!previous && kinds.every(kind => previous[`${kind}Image`] && previous[`${kind}Commit`]);
  const slots = [];
  for (const pool of selectedPools()) for (const serviceId of pool.ids) {
    const instance = await railwayInstance({ ...target(), serviceId });
    if (instance.source?.repo && !isRevlineRepository(instance.source.repo)) throw new Error(`Railway slot ${serviceId} builds another repository.`);
    const priorPool = previous && (pool.name === 'processor' ? previous.processorServices : pool.name === 'standard' ? previous.standardServices : previous.ultraServices);
    const restore = restorable && priorPool?.includes(serviceId) ? {
      image: pool.name === 'processor' ? previous.processorImage : previous.exportsImage, variables: slotVariables(previous, pool.name),
      commit: pool.name === 'processor' ? previous.processorCommit : previous.exportsCommit,
      deployment: instance.latestDeployment && ['SUCCESS', 'SLEEPING'].includes(instance.latestDeployment.status) ? instance.latestDeployment : null,
    } : null;
    slots.push({ pool: pool.name, serviceId, image: pool.image, variables: slotVariables(config, pool.name), restore });
  }
  if (hasRegistry) {
    // The registry check Railway will make, from here, in seconds: the new digests and the restore digests. It runs
    // whenever credentials exist, so a release:prod pre-flight made before Convex reports image slots checks them too.
    const images = new Map(selectedPools().map(pool => [pool.image, 'staged']));
    for (const slot of slots) if (slot.restore && !images.has(slot.restore.image)) images.set(slot.restore.image, 'restore');
    for (const [image, role] of images) {
      try { await verifyRegistryPull({ image, registryCredentials }); }
      catch (error) { throw new Error(`${role === 'staged' ? 'Staged' : 'Restore (previous release)'} image check failed: ${error instanceof Error ? error.message : error}`); }
    }
  }
  if (!restorable) console.log(`No pinned previous manifest for ${kinds.join(' and ')} on this deployment: a failure after the pause cannot be restored automatically and leaves claims paused (restore in the Railway dashboard).`);
  console.log(`Checks passed for ${slots.length} slot(s): variables and keys present, project token valid, ${hasRegistry ? 'staged and restore images pullable with the registry credentials, ' : ''}restore point ${restorable ? 'ready' : 'missing'}.`);
  // Pipes are asynchronous on macOS: flush before exiting so release:prod sees the whole report.
  if (operation === 'check') { await new Promise(done => process.stdout.write('', done)); process.exit(0); }

  // ---- 2. Runtime check of the image, before any slot changes ----
  // Image slots: one temporary service per image proves Railway pulls it and the runtime starts. Repository slots
  // still build in place (inside the restore scope below), as before.
  if (imageSlots) await Promise.all(kinds.map(kind => preflight(kind)));

  // ---- 3. Pause, drain, switch, verify the queue connection, resume. Any failure restores the previous images. ----
  let changed = false, paused = false, manifestWritten = false;
  const booted = [];
  const unchangedManifest = async () => {
    if ((await liveManifest() ?? '') !== (remote.RAILWAY_WORKERS_JSON ?? '')) throw new Error(`${deployment}'s RAILWAY_WORKERS_JSON changed while this stage ran (another stage?); it was not overwritten.`);
  };
  /** Put every slot back on the manifest that ran before this stage and resume claims. */
  const restore = async cause => {
    console.error(`\nStage failed: ${cause instanceof Error ? cause.message : cause}`);
    if (!changed) {
      if (paused) { await setEnv('RAILWAY_WORKERS_PAUSED', String(contract.paused)); await dispatch(); console.error('No slot had changed: claims resumed.'); }
      return;
    }
    if (!restorable) { console.error('No pinned previous manifest to restore; claims stay PAUSED. Restore by hand (docs/releases.md, Rollback).'); return; }
    console.error(`Restoring the slots to ${previous.processorCommit?.slice(0, 7)} (the manifest that ran before) and resuming claims.`);
    try {
      await setEnv('RAILWAY_WORKERS_PAUSED', 'true');
      paused = true;
      await waitStopped(20 * 60_000, [...selectedPools(), ...booted]);
      for (const slot of slots) {
        if (!slot.restore) { console.error(`  ${slot.serviceId}: not in the previous manifest; left as it is (dispatch does not start it).`); continue; }
        // Each slot keeps the source it has now: one that never switched to an image goes back to its repository build.
        // A slot reporting both (a switch Railway half-applied) is tried as an image, then as its repository build.
        const kind = railwaySlotSource(await railwayInstance({ ...target(), serviceId: slot.serviceId }));
        let source = null, lastError;
        for (const candidate of kind === 'repository' ? ['repository'] : kind === 'image' ? ['image'] : ['image', 'repository']) {
          try { await configureRailwaySlot({ ...target(), config: previous, serviceId: slot.serviceId, image: slot.restore.image, variables: slot.restore.variables, registryCredentials, source: candidate, warm: warm(slot.serviceId, previous) }); source = candidate; break; }
          catch (error) { lastError = error; }
        }
        if (!source) throw lastError;
        // Redeploying the build that ran before reuses its image; a new deployment of that commit would rebuild it.
        if (source === 'repository' && slot.restore.deployment?.meta?.commitHash === slot.restore.commit) await railway({ token, query: 'mutation($id: String!) { deploymentRedeploy(id: $id, usePreviousImageTag: true) { id } }', variables: { id: slot.restore.deployment.id } });
        console.error(`  ${slot.pool} ${slot.serviceId}: restored (${source === 'image' ? slot.restore.image : `repository build ${slot.restore.commit?.slice(0, 7)}`}).`);
      }
      // Only a manifest this stage wrote is put back, and it is read back before claims resume.
      if (manifestWritten) { await setEnv('RAILWAY_WORKERS_JSON', remote.RAILWAY_WORKERS_JSON); await expectManifest(previous, 'restored'); }
      if (remote.RAILWAY_API_TOKEN) await setEnv('RAILWAY_API_TOKEN', remote.RAILWAY_API_TOKEN);
      await setEnv('RAILWAY_WORKERS_PAUSED', String(contract.paused));
      await dispatch();
      console.error(`Restored: slots and ${deployment} back on the previous manifest; claims ${contract.paused ? 'stay paused as they were' : 'resumed'}.`);
    } catch (error) {
      console.error(`AUTOMATIC RESTORE FAILED: ${error instanceof Error ? error.message : error}. Claims stay PAUSED; restore by hand (docs/releases.md, Rollback).`);
    }
  };
  try {
    await unchangedManifest();
    paused = true;
    await setEnv('RAILWAY_WORKERS_PAUSED', 'true');
    await waitStopped();
    changed = true;
    for (const slot of slots) await configureRailwaySlot({ ...target(), serviceId: slot.serviceId, image: slot.image, variables: slot.variables, registryCredentials, source: imageSlots ? 'image' : 'repository', warm: warm(slot.serviceId) });
    await setEnv('RAILWAY_API_TOKEN', token);
    // Right before writing: the live manifest must still be the one this stage merged its kind into.
    await unchangedManifest();
    manifestWritten = true;
    await setEnv('RAILWAY_WORKERS_JSON', JSON.stringify(config));
    await expectManifest(config, 'staged');
    // Boot every lane production runs on Railway the way the dispatcher will start it, with the manifest just written,
    // while the backend forbids claims: a slot whose build or image differs from the manifest fails here, not on the
    // next upload. Each consumer authenticates and exits at idle before the hold is released. A lane this stage did not
    // change is never waited for while one of its slots still finishes a task.
    const staged = new Set(selectedPools().map(pool => pool.name));
    const lanes = [
      { name: 'processor', ids: config.processorServices, on: contract.processorBackend === 'railway' },
      { name: 'standard', ids: config.standardServices, on: contract.renderProvider === 'railway' },
      { name: 'ultra', ids: config.ultraServices, on: contract.renderProvider === 'railway' },
    ].filter(lane => lane.ids[0] && (staged.has(lane.name) || lane.on));
    for (const lane of lanes) {
      const serviceId = lane.ids[0];
      const instance = staged.has(lane.name) ? null : await railwayInstance({ ...target(), serviceId });
      if (instance && railwayActive(instance)) { console.log(`Railway ${lane.name} slot ${serviceId} is finishing a task; not booted (this stage did not change it).`); continue; }
      booted.push(lane);
      await verifyQueueConnection(serviceId, lane.name);
    }
  } catch (error) {
    await restore(error).catch(failure => console.error(`AUTOMATIC RESTORE FAILED: ${failure instanceof Error ? failure.message : failure}. Claims may stay PAUSED; restore by hand (docs/releases.md, Rollback).`));
    throw error;
  }
  // The file now holds what production runs (both kinds), so cutover/resume compare against the live manifest.
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  if (config.environment === 'production') await recordProductionStage({ config, kinds }).catch(error => console.error(`Could not record the production stage in the promotion ledger: ${error instanceof Error ? error.message : error}`));
  await writeFile(`${configPath}.verified.json`, JSON.stringify({ hash: hash(), kinds, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
  await setEnv('RAILWAY_WORKERS_PAUSED', String(contract.paused));
  await dispatch();
  console.log(`Railway ${imageSlots ? 'staged images' : 'repository builds'} staged and runtime verified; claims resumed. Processor backend and export provider unchanged.`);
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
