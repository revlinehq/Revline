// Production processor release. The R2, frontend and agent Workers stay on Cloudflare.
import { spawn } from 'node:child_process';
import { mkdir, open, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => !['--dry-run', '--processor-only', '--stage-only', '--image-first'].includes(arg))) throw new Error('Usage: npm run deploy:production [-- --dry-run] [--processor-only] [--stage-only] [--image-first]');
const state = join(root, '.data/production-releases');
await mkdir(state, { recursive: true });
const lockPath = join(state, 'release.lock');
const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Another production release is running. Inspect .data/production-releases/release.lock before retrying.'); });
const run = (command, argv) => new Promise((accept, reject) => {
  const child = spawn(command, argv, { cwd: root, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? accept() : reject(new Error('Production release did not finish. Completed steps are not rolled back automatically.')));
});
try {
  console.log('Target: production Convex different-gnu-398 and Fly revline-processor.');
  for (const name of ['typecheck', 'typecheck:agent-runner', 'typecheck:processor-edge']) await run('npm', ['run', name]);
  await run(process.execPath, ['scripts/deploy-fly-processor.mjs', '--prod',
    ...(args.includes('--processor-only') ? ['--skip-convex'] : []),
    ...args.filter(arg => arg !== '--processor-only')]);
} finally { await lock.close(); await rm(lockPath, { force: true }); }
