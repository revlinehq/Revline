// Build the Fly.io export image (Dockerfile target `exports`) on Fly's remote builder and
// point the matching Convex deployment at it. Running machines keep their image until the
// dispatcher next starts them; a stopped warm machine moves to the new image then.
//   npm run deploy:fly-exports            → revline-render-dev + Convex dev
//   npm run deploy:fly-exports -- --prod  → revline-render + Convex production
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => !['--prod', '--dry-run'].includes(arg))) throw new Error('Usage: npm run deploy:fly-exports [-- --prod] [--dry-run]');
const production = args.includes('--prod');
const app = production ? 'revline-render' : 'revline-render-dev';
const deployment = production ? 'different-gnu-398' : 'majestic-alpaca-541';
const settings = parseEnv(await readFile(process.env.REVLINE_ENV_FILE || join(root, production ? '.env.production.local' : '.env.local'), 'utf8'));
if (settings.CONVEX_DEPLOYMENT !== `${production ? 'prod' : 'dev'}:${deployment}` || settings.NEXT_PUBLIC_CONVEX_URL !== `https://${deployment}.convex.cloud`) throw new Error('Export environment does not match the selected deployment.');
const env = { ...process.env, ...settings };
if (!settings.CONVEX_DEPLOY_KEY) delete env.CONVEX_DEPLOY_KEY;
if (env.CONVEX_DEPLOY_KEY && !env.CONVEX_DEPLOY_KEY.startsWith(`prod:${deployment}|`)) throw new Error('Export deploy key targets the wrong environment.');
const convexTarget = ['--deployment', deployment];
const context = join(root, '.wrangler/media-processor-build');

function run(command, argv, options = {}) {
  return new Promise((accept, reject) => {
    let output = '';
    // flyctl reports the pushed image on stderr, so read both streams.
    const child = spawn(command, argv, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? accept(output) : reject(new Error(`${command} ${argv[0]} failed (${code}).`)));
  });
}

console.log(`Target: Fly app ${app}, Convex ${production ? 'production (different-gnu-398)' : 'development (majestic-alpaca-541)'}.`);
if (args.includes('--dry-run')) { console.log('Validated export target. No image built or deployment changed.'); process.exit(0); }
try {
  await run(process.execPath, ['infra/media-worker/prepare-context.mjs']);
  await writeFile(join(context, 'fly.toml'), `app = "${app}"\nprimary_region = "iad"\n[build]\n  dockerfile = "infra/media-worker/Dockerfile"\n  build-target = "exports"\n`);
  const label = `exports-${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim()}-${Date.now()}`;
  const output = await run('flyctl', ['deploy', '--build-only', '--push', '--remote-only', '--build-target', 'exports', '--image-label', label, '-a', app], { cwd: context });
  // Pin the pushed manifest; a Depot tag can be briefly unavailable after a push.
  const digest = [...output.matchAll(/pushing manifest for registry\.fly\.io\/[\w.:-]+@(sha256:[a-f0-9]{64})/g)].at(-1)?.[1];
  if (!digest) throw new Error('Fly did not report a pushed image digest.');
  const image = `registry.fly.io/${app}@${digest}`;
  await run('npx', ['convex', 'env', 'set', 'FLY_RENDER_IMAGE', image, ...convexTarget]);
  console.log(`Exports now use ${image}.`);
} finally { await rm(context, { recursive: true, force: true }); }
