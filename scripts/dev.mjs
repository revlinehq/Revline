import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const directory = fileURLToPath(new URL('..', import.meta.url));
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

function start(name, command) {
  const child = spawn(process.execPath, command, { cwd: directory, stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  children.add(child);
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', line => console.log(`[${name}] ${new Date().toISOString()} ${line}`));
  }
  child.on('error', error => { console.error(`[${name}] ${error.message}`); stop(1); });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) { console.error(`[${name}] stopped (${signal ?? code}). Stopping development services.`); stop(code || 1); }
  });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log(`Starting frontend${hasPort ? '' : ` at http://localhost:${port}`} and the development media worker. Ctrl+C stops both.`);
start('web', ['node_modules/next/dist/bin/next', 'dev', '--hostname', 'localhost', ...(!hasPort ? ['--port', port] : []), ...args]);
start('worker', ['--env-file=.env.local', '--import', 'tsx', 'scripts/media-worker.ts']);
