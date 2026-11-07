import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createServer } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import ts from 'typescript';
import { ConvexHttpClient } from 'convex/browser';
import { internal } from '../convex/_generated/api.js';
import { root, primary, common, shared, git, localEnv, readEnv, readState, statePath, runningDev, assertIsolated, saveJson, writeEnv, envLine, run, convex, sourceConvex, sourceValues, platform } from './isolated-common.mjs';

const registry = join(common, 'revline-isolated');
const hash = createHash('sha256').update(root).digest('hex').slice(0, 12);
const recordPath = join(registry, `${hash}.json`);
const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const ttl = 5 * 24 * 60 * 60_000;
const wrangler = (command, config, input) => run([join(root, 'node_modules/wrangler/bin/wrangler.js'), ...command, '--config', config], { input });
const announce = text => console.log(`[isolated] ${text}`);

async function cleanup(state) {
  if (!state.name || state.name === shared || state.root === primary || !state.reference?.startsWith('dev/sol/')) throw new Error('Refusing cleanup of an unrecognized deployment.');
  const deployed = await platform(`/deployments/${state.name}`);
  if (deployed && (deployed.deploymentType !== 'dev' || deployed.isDefault || deployed.reference !== state.reference)) throw new Error('Cleanup target no longer matches its isolated record.');
  announce(`target: dev (${state.name}, remove isolated backend and Workers)`);
  for (const name of [state.mediaName, state.runnerName]) {
    if (!/^revline-sol-(media|runner)-[a-f0-9]{12}$/.test(name)) throw new Error('Refusing cleanup of an unrecognized Worker.');
    // A minimal non-secret config works even after the worktree itself has been removed.
    const config = join(registry, `${hash}-cleanup.json`);
    saveJson(config, { name, account_id: '701645e913477e567db69b11343f59d8', compatibility_date: '2026-10-19' });
    try { await wrangler(['delete', '--force'], config); }
    catch (error) { if (!/10007|not found|does not exist/i.test(error.stderr ?? '')) throw error; }
    finally { rmSync(config, { force: true }); }
  }
  if (deployed) await platform(`/deployments/${state.name}/delete`, { method: 'POST' });
}

async function freePort(preferred) {
  for (let port = preferred; port < preferred + 100; port++) {
    if (port === 3001) continue;
    const available = await new Promise(resolve => {
      const server = createServer(); server.on('error', () => resolve(false));
      server.listen(port, 'localhost', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('No free isolated frontend port.');
}

async function sourceProject(state) {
  const projectId = option('--project') ?? state?.sourceProjectId;
  const ownerId = option('--source-owner') ?? (projectId === state?.sourceProjectId ? state?.sourceOwnerId ?? state?.ownerId : undefined);
  const projects = projectId && ownerId ? [{ _id: projectId, ownerId }] : JSON.parse(await sourceConvex(['data', 'projects', '--limit', '30', '--format', 'json']));
  for (const project of projects.filter(project => !project.deleting && (!projectId || project._id === projectId))) {
    const assets = JSON.parse(await sourceConvex(['run', 'assets:list', JSON.stringify({ projectId: project._id, limit: 200 }), '--identity', JSON.stringify({ subject: project.ownerId })]));
    if (args.includes('--snapshot')) {
      if (assets.length >= 200) throw new Error('Snapshot requires fewer than 200 assets to prove the source list is complete.');
      const read = (name, parameters) => sourceConvex(['run', name, JSON.stringify(parameters), '--identity', JSON.stringify({ subject: project.ownerId })]).then(JSON.parse);
      const original = await read('projects:get', { projectId: project._id, includeHistory: false });
      if (!original || original.aiRunning) throw new Error('Snapshot source is unavailable or editing; retry after it finishes.');
      const hydrated = [];
      for (const asset of assets) {
        const { url: _url, previewUrl: _preview, thumbnailUrl: _thumbnail, previewSegments: _segments, ...savedAsset } = await read('assets:get', { projectId: project._id, assetId: asset._id });
        hydrated.push({ ...savedAsset, url: null });
      }
      if (hydrated.some(asset => !asset.r2Key)) throw new Error('Faithful snapshots require every source asset to use R2; legacy Convex files cannot cross deployments.');
      const saved = await read('timelineTabs:snapshots', { projectId: project._id });
      const again = await read('projects:get', { projectId: project._id, includeHistory: false });
      if (again.revision !== original.revision || again.updatedAt !== original.updatedAt || again.activeTimelineId !== original.activeTimelineId) throw new Error('Source changed during snapshot reads; retry.');
      return { projectId: project._id, ownerId: project.ownerId, assets: hydrated,
        snapshot: { sourceProjectId: project._id, timeline: original.timeline,
          tabs: (original.timelineTabs ?? [{ id: 'main', name: 'Timeline 1' }]).map(({ id, name }) => ({ id, name })),
          activeTimelineId: original.activeTimelineId ?? original.timelineTabs?.[0]?.id ?? 'main', saved } };
    }
    const borrowed = assets.filter(asset => asset.r2Key && ['video', 'image', 'audio'].includes(asset.kind)).slice(0, 20);
    if (!borrowed.some(asset => asset.kind === 'video' && asset.duration > 0)) continue;
    return { projectId: project._id, ownerId: project.ownerId, assets: borrowed.map(asset => Object.fromEntries(['r2Key', 'fileName', 'contentType', 'size', 'kind', 'duration', 'width', 'height'].flatMap(key => asset[key] === undefined ? [] : [[key, asset[key]]]))) };
  }
  throw new Error('No dev project with R2 video found. Pass --project=<dev-project-id> and --source-owner=<clerk-dev-user-id>.');
}

async function setValues(values) {
  const bulk = Object.entries(values).flatMap(([key, value]) => envLine(key, value) ?? []);
  await convex(['env', 'set', '--force'], { input: bulk.join('\n') });
  // Unusual values containing every quote delimiter travel as a single raw stdin value.
  for (const [key, value] of Object.entries(values)) if (!envLine(key, value)) await convex(['env', 'set', key], { input: value });
}

async function workerConfig(source, name, vars) {
  const config = ts.parseConfigFileTextToJson(source, readFileSync(join(root, source), 'utf8')).config;
  config.main = join(root, source, '..', config.main);
  config.name = name; config.vars = vars;
  config.$schema = join(root, 'node_modules/wrangler/config-schema.json');
  // Resolve SDK packages from the worktree, not from the generated config directory.
  const path = join(root, `.data/isolated/${name}.json`);
  saveJson(path, config);
  return path;
}

try {
  if (root === primary || git('branch', '--show-current') === 'main') throw new Error('Use npm run dev on main. Isolated startup belongs in an agent worktree.');
  if (runningDev()) throw new Error('This worktree’s development services are running. Stop them before reconfiguring or cleaning up its backend.');
  if (args.includes('--cleanup')) {
    const state = readState();
    if (state) { await cleanup(state); rmSync(recordPath, { force: true }); rmSync(statePath, { force: true }); }
    announce('Cleanup complete.');
    process.exit(0);
  }
  // Bounded, opportunistic cleanup; Convex also expires backends server-side when this PC is off.
  if (existsSync(registry)) for (const file of readdirSync(registry).filter(file => file.endsWith('.json') && !file.endsWith('-cleanup.json'))) {
    const state = JSON.parse(readFileSync(join(registry, file), 'utf8'));
    if (state.root !== root && (!existsSync(join(state.root, '.git')) || state.expiresAt < Date.now())) {
      await cleanup(state); rmSync(join(registry, file), { force: true });
    }
  }
  const main = readEnv(process.env.REVLINE_MAIN_ENV ?? join(primary, '.env.local'));
  if (main.CONVEX_DEPLOYMENT !== `dev:${shared}` || !main.CLERK_SECRET_KEY?.startsWith('sk_test_') || !main.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')) throw new Error('Primary checkout must point at shared dev and Clerk dev. Production credentials are never accepted.');
  const source = await platform(`/deployments/${shared}`);
  if (source?.deploymentType !== 'dev') throw new Error('Shared source is not a dev deployment.');
  let state = readState();
  if (state && state.root !== root) throw new Error('Isolation state belongs to a different worktree.');
  if (state) {
    const existing = await platform(`/deployments/${state.name}`);
    if (!existing) state = null;
    else if (existing.deploymentType !== 'dev' || existing.isDefault || existing.projectId !== source.projectId || existing.reference !== state.reference) throw new Error('Isolated deployment identity changed.');
  }
  if (!state) {
    const reference = `dev/sol/${basename(root).replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 45)}-${hash}`;
    announce(`target: dev (${reference}, new isolated backend; expires in five days)`);
    // Only public settings/pointers are copied to disk. Backend secrets stay in memory and stdin.
    const publicEnv = Object.fromEntries(Object.entries(main).filter(([key]) => key.startsWith('NEXT_PUBLIC_CLERK_')));
    writeEnv({ ...publicEnv, CONVEX_DEPLOYMENT: `dev:${shared}` });
    await convex(['deployment', 'create', reference, '--type', 'dev', '--region', source.region, '--expiration', 'in 5 days', '--select'], { env: { CONVEX_DEPLOY_KEY: '', CONVEX_DEPLOYMENT_TOKEN: '' } });
    const selected = localEnv();
    const name = new URL(selected.NEXT_PUBLIC_CONVEX_URL).hostname.split('.')[0];
    if (name === shared) throw new Error('Provisioning selected the shared backend.');
    const created = await platform(`/deployments/${name}`);
    if (created?.deploymentType !== 'dev' || created.isDefault || created.projectId !== source.projectId || created.reference !== reference) throw new Error('Provisioning did not select the requested isolated dev backend.');
    await convex(['deployment', 'token', 'create', 'sol-worktree', '--save-env'], { env: { CONVEX_DEPLOY_KEY: '', CONVEX_DEPLOYMENT_TOKEN: '' } });
    const scoped = localEnv();
    // Older CLI formats and future selector formats resolve to a concrete dev name for the guard.
    writeEnv({ ...scoped, CONVEX_DEPLOYMENT: `dev:${name}` });
    state = { root, reference, name, port: await freePort(3100 + parseInt(hash.slice(0, 4), 16) % 1000), mediaName: `revline-sol-media-${hash}`, runnerName: `revline-sol-runner-${hash}`, expiresAt: Date.now() + ttl };
    saveJson(statePath, state); saveJson(recordPath, state);
  }
  // A copied main env file must never redirect even an internal setup command to shared dev.
  assertIsolated(state);
  announce(`target: dev (${state.name}, isolated; shared ${shared} is read-only)`);
  // Refresh expiration only while in use. Removed or idle worktrees expire within five days.
  await platform(`/deployments/${state.name}`, { method: 'PATCH', body: { expiresAt: Date.now() + ttl } });
  state.expiresAt = Date.now() + ttl;
  state.port = await freePort(state.port);
  saveJson(statePath, state); saveJson(recordPath, state);
  const settings = await sourceValues();
  const project = await sourceProject(state);
  const keys = project.assets.flatMap(asset => [asset.r2Key, asset.previewR2Key].filter(Boolean));
  const previous = parseEnv(await convex(['env', 'list']));
  const secret = name => previous[name] || randomBytes(32).toString('hex');
  const origin = `http://localhost:${state.port}`;
  const site = `https://${state.name}.convex.site`;
  const overrides = {
    REVLINE_ISOLATED: 'true', REVLINE_BORROWED_MEDIA_KEYS: JSON.stringify([...new Set([...JSON.parse(previous.REVLINE_BORROWED_MEDIA_KEYS ?? '[]'), ...keys])]),
    APP_ORIGIN: origin, MCP_PUBLIC_ORIGIN: site, BILLING_ENABLED: 'false', DISCORD_ALERTS_ENABLED: 'false',
    RENDER_WORKER_SECRET: secret('RENDER_WORKER_SECRET'), MEDIA_SIGNING_SECRET: secret('MEDIA_SIGNING_SECRET'),
    AGENT_RUNNER_SECRET: secret('AGENT_RUNNER_SECRET'), AGENT_RUNNER_RUN_KEY: secret('AGENT_RUNNER_RUN_KEY'),
    REVLINE_MCP_TOKEN: previous.REVLINE_MCP_TOKEN || `rvl_pat_${randomBytes(32).toString('hex')}`,
    // Hosted processors wake the shared queue. Isolated media tasks are handled by this worktree's local worker.
    MEDIA_PROCESSOR_WAKE_URL: '', MEDIA_PROCESSOR_BACKEND: 'local', RENDER_PROVIDER: 'local',
  };
  const mediaConfig = await workerConfig('cf-workers/media/wrangler.jsonc', state.mediaName, { ALLOWED_ORIGINS: origin, READ_ONLY_MEDIA_KEYS: overrides.REVLINE_BORROWED_MEDIA_KEYS });
  const runnerConfig = await workerConfig('cf-workers/agent-runner/wrangler.jsonc', state.runnerName, { CONVEX_SITE_URL: site });
  if (!existsSync(join(root, 'cf-workers/agent-runner/node_modules/agents'))) execFileSync('npm', ['ci', '--prefix', 'cf-workers/agent-runner', '--legacy-peer-deps', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
  // Worker secrets go through stdin; no .dev.vars or secret JSON files are created.
  announce('Deploying this worktree’s media Worker and editor runner.');
  const mediaDeploy = await wrangler(['deploy'], mediaConfig);
  const runnerDeploy = await wrangler(['deploy'], runnerConfig);
  const workerUrl = output => output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/)?.[0];
  overrides.MEDIA_WORKER_URL = workerUrl(mediaDeploy);
  overrides.AGENT_RUNNER_URL = workerUrl(runnerDeploy);
  if (!overrides.MEDIA_WORKER_URL || !overrides.AGENT_RUNNER_URL) throw new Error('Wrangler did not report isolated Worker URLs.');
  const values = { ...settings, ...overrides };
  // Never carry deployment selectors, production service hooks, or default-runner URLs into the new backend.
  const omitted = [...new Set([...Object.keys(settings), ...Object.keys(previous)].filter(key => key.startsWith('FLY_') || key.startsWith('RAILWAY_'))), 'CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT_TOKEN', 'CONVEX_URL', 'CONVEX_SITE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLERK_WEBHOOK_SIGNING_SECRET', 'DISCORD_WEBHOOK_URL', 'RENDER_WORKER_SECRET_PREVIOUS', 'MEDIA_WORKER_SECRET_EXPORTS'];
  for (const key of omitted) delete values[key];
  await setValues(values);
  for (const key of omitted) if (previous[key] !== undefined) await convex(['env', 'remove', key]);
  await wrangler(['secret', 'bulk'], mediaConfig, JSON.stringify({ MEDIA_SIGNING_SECRET: values.MEDIA_SIGNING_SECRET }));
  const runnerSecrets = Object.fromEntries(Object.entries(values).filter(([key]) => /^(ANTHROPIC_|OPENAI_|GOOGLE_|ELEVENLABS_|GEMINI_|EDITOR_|MODEL_SWITCHER_|AI_|MEDIA_WORKER_URL$|MEDIA_SIGNING_SECRET$|MCP_PUBLIC_ORIGIN$|APP_ORIGIN$|AGENT_RUNNER_SECRET$)/.test(key)));
  await wrangler(['secret', 'bulk'], runnerConfig, JSON.stringify(runnerSecrets));
  announce(`Copied ${Object.keys(values).length} backend settings through stdin; deploying branch functions.`);
  await convex(['dev', '--once']);
  const client = new ConvexHttpClient(`https://${state.name}.convex.cloud`);
  client.setAdminAuth(localEnv().CONVEX_DEPLOY_KEY);
  const tokenHash = createHash('sha256').update(values.REVLINE_MCP_TOKEN).digest('base64url');
  const ownerId = option('--owner') ?? state.ownerId ?? project.ownerId;
  const bootstrapAssets = project.assets.filter(asset => ['video', 'audio', 'image'].includes(asset.kind)).slice(0, 20).map(asset => Object.fromEntries(['r2Key', 'fileName', 'contentType', 'size', 'kind', 'duration', 'width', 'height'].flatMap(key => asset[key] === undefined ? [] : [[key, asset[key]]])));
  let seeded = await client.mutation(internal.devIsolation.seed, { ownerId, title: `Isolated · ${basename(root)}`, assets: bootstrapAssets, tokenHash });
  if (project.snapshot) {
    if (state.snapshotSourceProjectId === project.projectId && !args.includes('--fresh-snapshot')) seeded = { projectId: state.projectId, assetIds: state.assetIds, timelineId: state.timelineId };
    else seeded = await client.mutation(internal.devIsolation.importSnapshot, { ownerId, title: `Snapshot · ${basename(root)}`, assets: project.assets, ...project.snapshot });
  }
  state = { ...state, ...seeded, ownerId, sourceOwnerId: project.ownerId, sourceProjectId: project.projectId, snapshotSourceProjectId: project.snapshot ? project.projectId : undefined };
  saveJson(statePath, state); saveJson(recordPath, state);
  announce(`Ready: ${origin}/editor/${seeded.projectId} · owner ${state.ownerId} · ${seeded.assetIds.length} media references · timeline ${seeded.timelineId}`);
  announce('MCP: node scripts/isolated-mcp.mjs (stdio, scoped to this backend).');
  if (!args.includes('--setup-only')) {
    const child = spawn('npm', ['run', 'dev'], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: String(state.port) } });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('exit', code => { process.exitCode = code ?? 1; });
  }
} catch (error) { console.error(`[isolated] ${error.message}`); process.exitCode = 1; }
