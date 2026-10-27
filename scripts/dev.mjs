import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { aiCostLines } from './ai-cost-log-filter.mjs';
import { execFileSync } from 'node:child_process';

const directory = fileURLToPath(new URL('..', import.meta.url));
// The editor and media worker load the vendor runtimes from public/vendor; rebuild them from source on every start.
execFileSync(process.execPath, ['scripts/copy-vendor.mjs'], { cwd: directory, stdio: 'inherit' });
const args = process.argv.slice(2);
const hasPort = args.some(arg => arg === '--port' || arg === '-p' || arg.startsWith('--port='));
const port = process.env.PORT || '3001';
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  const force = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 5000);
  force.unref();
}

function start(name, command, { required = true, filter } = {}) {
  const child = spawn(process.execPath, command, { cwd: directory, stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  children.add(child);
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', line => {
      for (const output of filter ? filter(line) : [line]) console.log(`[${name}] ${new Date().toISOString()} ${output}`);
    });
  }
  child.on('error', error => { console.error(`[${name}] ${error.message}`); if (required) stop(1); });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`[${name}] stopped (${signal ?? code}). ${required ? 'Stopping development services.' : 'AI cost log tail is unavailable; frontend and worker keep running.'}`);
      if (required) stop(code || 1);
    }
  });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log(`Starting frontend${hasPort ? '' : ` at http://localhost:${port}`} and the development media worker. Ctrl+C stops both.`);
start('web', ['node_modules/next/dist/bin/next', 'dev', '--hostname', 'localhost', ...(!hasPort ? ['--port', port] : []), ...args]);
start('worker', ['--env-file=.env.local', '--import', 'tsx', 'scripts/media-worker.ts']);
console.log('[ai] Watching structured AI cost logs from the Convex development deployment (read only).');
start('ai', ['node_modules/convex/bin/main.js', 'logs', '--deployment', 'dev', '--history', '0', '--jsonl'], { required: false, filter: aiCostLines });
