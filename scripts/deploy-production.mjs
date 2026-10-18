import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, cp, symlink, open, rm, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dry-run')) throw new Error('Usage: npm run deploy:production [-- --dry-run]');
const dryRun = args.includes('--dry-run');
const deployment = 'different-gnu-398', convexUrl = `https://${deployment}.convex.cloud`;
const envFile = join(root, '.env.production.local');
const production = parseEnv(await readFile(envFile, 'utf8'));
if (production.CONVEX_DEPLOYMENT !== `prod:${deployment}` || production.NEXT_PUBLIC_CONVEX_URL !== convexUrl) throw new Error('Production environment does not match different-gnu-398.');
if (!production.RENDER_WORKER_SECRET) throw new Error('Production worker verification secret is missing.');
if (production.CONVEX_DEPLOY_KEY && !production.CONVEX_DEPLOY_KEY.startsWith(`prod:${deployment}|`)) throw new Error('Production deploy key targets a different deployment.');
const env = { ...process.env, ...production, CI: '1' };
if (!production.CONVEX_DEPLOY_KEY) delete env.CONVEX_DEPLOY_KEY;
const cli = name => join(root, 'node_modules', ...name.split('/'));
const run = async (command, argv, cwd = root) => {
  await new Promise((accept, reject) => {
    const child = spawn(command, argv, { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`${command} failed (${signal ?? code}). Release is not complete.`)));
  });
};
const node = (argv, cwd) => run(process.execPath, argv, cwd);
const state = join(root, '.data', 'production-releases');
await mkdir(state, { recursive: true });
const lockPath = join(state, 'release.lock');
const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Another production release is running. Inspect .data/production-releases/release.lock before retrying.'); });
const releaseId = `release-${Date.now()}`;
const directory = join(state, releaseId), source = join(directory, 'source');
let stage = 'preflight';
const hashTree = async directory => {
  const hash = createHash('sha256');
  async function visit(path, prefix = '') {
    for (const item of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const relative = join(prefix, item.name);
      if (item.isDirectory()) await visit(join(path, item.name), relative);
      else if (item.isFile()) { hash.update(relative); hash.update(await readFile(join(path, item.name))); }
      else throw new Error('Unexpected symlink in release source.');
    }
  }
  await visit(directory);
  return hash.digest('hex');
};
try {
  console.log(`Target: production (${deployment}); Cloudflare revline-media-processor-production. ${dryRun ? 'Validation only.' : 'Deploying both services.'}`);
  await node([cli('typescript/bin/tsc'), '--noEmit']);
  await node([cli('typescript/bin/tsc'), '-p', 'infra/media-worker/edge/tsconfig.json']);
  await node(['infra/media-worker/prepare-context.mjs']);
  await mkdir(directory, { recursive: true });
  await cp(join(root, '.wrangler/media-processor-build'), source, { recursive: true });
  const sourceHash = await hashTree(source);
  const config = JSON.parse(await readFile(join(source, 'infra/media-worker/edge/wrangler.jsonc'), 'utf8'));
  if (config.name !== 'revline-media-processor-production' || config.vars.NEXT_PUBLIC_CONVEX_URL !== convexUrl) throw new Error('Cloudflare target does not match production.');
  config.$schema = cli('wrangler/config-schema.json');
  config.main = join(source, 'infra/media-worker/edge/cloudflare.ts');
  config.containers[0].images.processor = { dockerfile: join(source, 'infra/media-worker/Dockerfile'), build_context: source };
  const configPath = join(directory, 'wrangler.production.json');
  // A dry run validates bundling without uploading an image or changing services.
  const tag = `revline-media-processor:${releaseId}`;
  if (!dryRun) {
    stage = 'local image verification';
    await run('docker', ['build', '--platform', 'linux/amd64', '-f', config.containers[0].images.processor.dockerfile, '-t', tag, source]);
    await run('docker', ['run', '--rm', '--network=none', '--entrypoint', 'node', tag, 'infra/media-worker/runtime-check.mjs']);
    stage = 'registry upload';
    await node([cli('wrangler/bin/wrangler.js'), 'containers', 'push', tag, '--config', join(root, 'infra/media-worker/edge/wrangler.jsonc')]);
    const registry = `registry.cloudflare.com/${config.account_id}/revline-media-processor`;
    const output = await new Promise((accept, reject) => {
      const child = spawn('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', tag], { env, stdio: ['ignore', 'pipe', 'inherit'] });
      let text = ''; child.stdout.on('data', chunk => { text += chunk; });
      child.on('error', reject); child.on('exit', code => code === 0 ? accept(text) : reject(new Error('Cannot inspect uploaded image digest.')));
    });
    const image = JSON.parse(output).find(value => value.startsWith(`${registry}@sha256:`));
    if (!image) throw new Error('Registry did not confirm an immutable image digest.');
    config.containers[0].images.processor = { image };
  } else config.containers[0].images.processor = { image: `registry.cloudflare.com/${config.account_id}/revline-media-processor@sha256:${'0'.repeat(64)}` };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  if (await hashTree(source) !== sourceHash) throw new Error('Frozen source changed during image build.');
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ releaseId, deployment, sourceHash, image: config.containers[0].images.processor, dryRun }, null, 2) + '\n');
  stage = 'Cloudflare deployment';
  await node([cli('wrangler/bin/wrangler.js'), 'deploy', '--config', configPath, '--keep-vars', '--strict', '--tag', releaseId, ...(dryRun ? ['--dry-run', '--outdir', join(directory,'bundle')] : [])]);
  // Convex deploys the exact frozen backend used for the image, not later edits.
  await symlink(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
  stage = 'Convex deployment';
  await node([cli('convex/bin/main.js'), 'deploy', '--env-file', envFile, '--typecheck', 'enable', '--message', releaseId, ...(dryRun ? ['--dry-run'] : [])], source);
  if (dryRun) { console.log('Validation passed. No image was uploaded and neither service was deployed.'); }
  else {
    stage = 'release verification';
    const client = new ConvexHttpClient(convexUrl);
    const contract = await client.query(makeFunctionReference('mediaTasks:processorContract'), { workerSecret: production.RENDER_WORKER_SECRET });
    const base = `https://${config.name}.makaradze98-s.workers.dev`;
    const headers = { authorization: `Bearer ${production.RENDER_WORKER_SECRET}` };
    const wake = await fetch(`${base}/wake`, { method: 'POST', headers, signal: AbortSignal.timeout(15000) });
    if (!wake.ok) throw new Error('Worker wake failed after deployment.');
    const deadline = Date.now() + 20 * 60_000;
    while (true) {
      const response = await fetch(`${base}/status`, { headers, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Worker status failed after deployment.');
      const status = await response.json();
      if (status.processorVersion !== contract.processorVersion) throw new Error('Cloudflare and Convex processor contracts differ.');
      const expectedImage = config.containers[0].images.processor.image;
      if (!status.processors?.length || status.processors.some(slot => slot.configuredImage !== expectedImage)) throw new Error('Cloudflare is not configured with this release image.');
      if (status.processors.every(slot => !slot.running || slot.healthy && !slot.draining && slot.processorVersion === contract.processorVersion && slot.image === expectedImage)) break;
      if (Date.now() >= deadline) throw new Error('Previous workers have not drained. Deployment is not verified; active jobs were preserved.');
      console.log('Waiting for previous workers to finish active jobs and drain.');
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
    console.log(`Verified production release ${releaseId}: Cloudflare and Convex agree on processor version ${contract.processorVersion}.`);
  }
} catch (error) {
  console.error(`Production release stopped during ${stage}. ${error.message} Completed deployment steps are not rolled back automatically.`);
  process.exitCode = 1;
} finally { await lock.close(); await rm(lockPath, { force: true }); }
