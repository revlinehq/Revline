// Remote build, isolated runtime preflight, then an atomic queue backend cutover.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => !['--prod', '--stage-only', '--skip-convex', '--dry-run', '--image-first'].includes(arg))) throw new Error('Usage: npm run deploy:fly-processor [-- --prod] [--stage-only] [--skip-convex] [--dry-run] [--image-first]');
if (args.includes('--image-first') && !args.includes('--skip-convex')) throw new Error('--image-first requires --skip-convex; deploy and verify Convex immediately afterwards.');
const production = args.includes('--prod'), dryRun = args.includes('--dry-run');
const app = production ? 'revline-processor' : 'revline-processor-dev';
const deployment = production ? 'different-gnu-398' : 'majestic-alpaca-541';
const convexUrl = `https://${deployment}.convex.cloud`;
const envFile = process.env.REVLINE_ENV_FILE || join(root, production ? '.env.production.local' : '.env.local');
const settings = parseEnv(await readFile(envFile, 'utf8'));
if (settings.CONVEX_DEPLOYMENT !== `${production ? 'prod' : 'dev'}:${deployment}` || settings.NEXT_PUBLIC_CONVEX_URL !== convexUrl) throw new Error('Environment file targets the wrong Convex deployment.');
const env = { ...process.env, ...settings };
if (!settings.CONVEX_DEPLOY_KEY) delete env.CONVEX_DEPLOY_KEY;
if (env.CONVEX_DEPLOY_KEY && !env.CONVEX_DEPLOY_KEY.startsWith(`prod:${deployment}|`)) throw new Error('Deploy key does not match the selected environment.');
const cli = join(root, 'node_modules/convex/bin/main.js');
const target = ['--deployment', deployment];
const context = join(root, '.wrangler/media-processor-build');
console.log(`Target: Fly ${app}, Convex ${production ? 'production' : 'development'} (${deployment}). ${dryRun ? 'Validation only.' : args.includes('--stage-only') ? 'Staging without queue cutover.' : 'Activating after runtime verification.'}`);

function run(command, argv, { cwd = root, input, quiet = false, combined = false } = {}) {
  return new Promise((accept, reject) => {
    let output = '';
    const child = spawn(command, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on('data', chunk => { if (stream === child.stdout || combined) output += chunk; if (!quiet) destination.write(chunk); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? accept(output.trim()) : reject(new Error(`${command} ${argv[0]} failed (${code}).${quiet ? ' Credentials were withheld from logs.' : ''}`)));
    child.stdin.end(input);
  });
}
const convex = (argv, options) => run(process.execPath, [cli, ...argv], options);
const setEnv = (name, value) => convex(['env', 'set', name, ...target], { input: value, quiet: true });
// Secrets are resolved from the selected deployment, never from another app or environment.
const remote = parseEnv(await convex(['env', 'list', ...target], { quiet: true }));
const workerSecret = remote.RENDER_WORKER_SECRET;
if (!workerSecret || !remote.MEDIA_WORKER_URL) throw new Error('The selected Convex deployment is missing media credentials.');
const secrets = { RENDER_WORKER_SECRET: workerSecret, NEXT_PUBLIC_CONVEX_URL: convexUrl, MEDIA_WORKER_URL: remote.MEDIA_WORKER_URL };
for (const name of ['DEEPGRAM_API_KEY', 'FAL_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']) {
  const value = settings[name] || env[name] || remote[name];
  if (!value) throw new Error(`${name} is required in the selected environment for the full processor.`);
  secrets[name] = value;
}
for (const name of ['GEMINI_VIDEO_MODEL', 'MEDIA_VISION_GEMINI_FALLBACK']) if (settings[name]) secrets[name] = settings[name];
if (dryRun) { console.log('Environment and required runtime credentials verified. No cloud resources changed.'); process.exit(0); }

let preflight;
let preflightVolume;
let token;
async function fly(method, path, body) {
  const authorization = token.startsWith('FlyV1 ') ? token : `Bearer ${token}`;
  const response = await fetch(`https://api.machines.dev/v1/apps/${app}${path}`, { method, headers: { authorization, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Fly ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
try {
  // A missing app is created only in the explicitly selected environment.
  const apps = JSON.parse(await run('flyctl', ['apps', 'list', '--json'], { quiet: true }));
  if (!apps.some(item => item.Name === app)) await run('flyctl', ['apps', 'create', app, '--org', 'personal']);
  await run('flyctl', ['secrets', 'import', '--stage', '-a', app], { input: Object.entries(secrets).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n'), quiet: true });
  await run(process.execPath, ['infra/media-worker/prepare-context.mjs']);
  await writeFile(join(context, 'fly.toml'), `app = "${app}"\nprimary_region = "iad"\n[build]\n  dockerfile = "infra/media-worker/Dockerfile"\n  build-target = "fly-processor"\n`);
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const output = await run('flyctl', ['deploy', '--build-only', '--push', '--remote-only', '--build-target', 'fly-processor', '--image-label', `processor-${revision}-${Date.now()}`, '-a', app], { cwd: context, combined: true });
  // Depot can publish the manifest before its requested tag becomes resolvable.
  // Pin the pushed digest, which is also the exact artifact the preflight verifies.
  const digest = [...output.matchAll(/pushing manifest for registry\.fly\.io\/[\w.:-]+@(sha256:[a-f0-9]{64})/g)].at(-1)?.[1];
  if (!digest) throw new Error('Fly did not report a pushed image digest. Backend unchanged.');
  const image = `registry.fly.io/${app}@${digest}`;
  token = env.FLY_PROCESSOR_API_TOKEN || remote.FLY_PROCESSOR_API_TOKEN || await run('flyctl', ['tokens', 'create', 'deploy', '-a', app, '--name', `convex-processor-${deployment}`, '--expiry', '8760h'], { quiet: true });
  // This process checks the full runtime without subscribing to or claiming the queue.
  preflightVolume = await fly('POST', '/volumes', { name: 'processor_preflight', region: 'iad', size_gb: 20, require_unique_zone: false, snapshot_retention: 1, auto_backup_enabled: false });
  if (preflightVolume.auto_backup_enabled !== false) throw new Error('Fly preflight scratch snapshots were not disabled.');
  const manifestDeadline = Date.now() + 120_000;
  while (!preflight) {
    try {
      preflight = await fly('POST', '/machines', { region: 'iad', config: { image, init: { exec: ['sh', '-c', 'cd /app && node infra/media-worker/runtime-check.mjs'] }, guest: { cpu_kind: 'performance', cpus: 8, memory_mb: 16384 }, mounts: [{ volume: preflightVolume.id, path: '/scratch' }], restart: { policy: 'no' }, metadata: { revline_preflight: 'true' } } });
    } catch (error) {
      // A pushed manifest can take a few seconds to reach Machines' registry
      // resolver. A rejected manifest create has no machine to orphan.
      if (!(error instanceof Error) || !/failed to get manifest|MANIFEST_UNKNOWN/i.test(error.message) || Date.now() >= manifestDeadline) throw error;
      console.log('Waiting for the pushed manifest to reach the Fly Machines registry resolver.');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  const deadline = Date.now() + 10 * 60_000;
  while (true) {
    const machine = await fly('GET', `/machines/${preflight.id}`);
    if (machine.state === 'stopped') {
      const exit = machine.events?.find(event => event.type === 'exit')?.request?.exit_event;
      if (exit?.exit_code !== 0 || exit?.oom_killed) throw new Error('Fly runtime preflight failed. Inspect the app logs before cutover.');
      break;
    }
    if (Date.now() > deadline) throw new Error('Fly runtime preflight did not finish. Backend unchanged.');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  await fly('DELETE', `/machines/${preflight.id}`); preflight = undefined;
  await fly('DELETE', `/volumes/${preflightVolume.id}`); preflightVolume = undefined;
  if (!args.includes('--skip-convex')) await convex(production ? ['deploy', '--yes', '--env-file', envFile, '--typecheck', 'enable'] : ['dev', '--once', '--typecheck', 'enable']);
  const contract = await new ConvexHttpClient(convexUrl).query(makeFunctionReference('mediaTasks:processorContract'), { workerSecret });
  const versionSource = await readFile(join(root, 'lib/media-analysis/processor-version.ts'), 'utf8');
  const expected = Number(/MEDIA_PROCESSOR_VERSION\s*=\s*(\d+)/.exec(versionSource)?.[1]);
  if (args.includes('--image-first') ? contract.processorVersion > expected : contract.processorVersion !== expected) throw new Error('Deployed Convex processor contract differs from the image source.');
  // --image-first publishes a preflighted, backwards-compatible image before the
  // backend raises its required version. The release pipeline verifies the new contract next.
  // Publish image configuration only after the image and backend are verified. Active
  // machines finish on their old image; every subsequent machine uses this release.
  for (const [name, value] of Object.entries({ FLY_PROCESSOR_APP: app, FLY_PROCESSOR_IMAGE: image, FLY_PROCESSOR_API_TOKEN: token })) await setEnv(name, value);
  if (!args.includes('--stage-only')) {
    await setEnv('MEDIA_PROCESSOR_BACKEND', 'fly');
    await convex(['run', 'flyProcessor:dispatch', '{}', ...target]);
  }
  console.log(`Verified ${app} image ${image}, processor contract ${expected}. ${args.includes('--stage-only') ? 'Queue backend unchanged.' : 'Queue backend: fly. Cloudflare is retained for rollback.'}`);
} finally {
  if (preflight && token) await fly('DELETE', `/machines/${preflight.id}?force=true`).catch(() => {});
  if (preflightVolume && token) await fly('DELETE', `/volumes/${preflightVolume.id}`).catch(() => {});
  await rm(context, { recursive: true, force: true });
}
