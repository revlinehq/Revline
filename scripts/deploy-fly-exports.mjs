// Build the Fly.io export image (Dockerfile target `exports`) on Fly's remote builder and
// point the matching Convex deployment at it. Running machines keep their image until the
// dispatcher next starts them; a stopped warm machine moves to the new image then.
//   npm run deploy:fly-exports            → revline-render-dev + Convex dev
//   npm run deploy:fly-exports -- --prod  → revline-render + Convex production
import { spawn, execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--prod')) throw new Error('Usage: npm run deploy:fly-exports [-- --prod]');
const production = args.includes('--prod');
const app = production ? 'revline-render' : 'revline-render-dev';
const convexTarget = production ? ['--prod'] : [];
const context = join(root, '.wrangler/media-processor-build');

function run(command, argv, options = {}) {
  return new Promise((accept, reject) => {
    let output = '';
    const child = spawn(command, argv, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], ...options });
    child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? accept(output) : reject(new Error(`${command} ${argv[0]} failed (${code}).`)));
  });
}

console.log(`Target: Fly app ${app}, Convex ${production ? 'production (different-gnu-398)' : 'development (majestic-alpaca-541)'}.`);
await run(process.execPath, ['infra/media-worker/prepare-context.mjs']);
await writeFile(join(context, 'fly.toml'), `app = "${app}"\nprimary_region = "iad"\n[build]\n  dockerfile = "infra/media-worker/Dockerfile"\n  build-target = "exports"\n`);
const label = `exports-${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim()}-${Date.now()}`;
const output = await run('fly', ['deploy', '--build-only', '--push', '--remote-only', '--build-target', 'exports', '--image-label', label, '-a', app], { cwd: context });
const image = /^image: (registry\.fly\.io\/\S+)$/m.exec(output)?.[1];
if (!image || !image.startsWith(`registry.fly.io/${app}:`)) throw new Error('Fly did not report the pushed image.');
await run('npx', ['convex', 'env', 'set', 'FLY_RENDER_IMAGE', image, ...convexTarget]);
console.log(`Exports now use ${image}.`);
