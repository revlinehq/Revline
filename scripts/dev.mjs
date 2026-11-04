import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { aiCostLines } from './ai-cost-log-filter.mjs';
import { root, primary, git, isolatedRuntime, runningDev, devPidPath } from './isolated-common.mjs';

if (root !== primary || git('branch', '--show-current') !== 'main') {
  if (runningDev()) throw new Error('This worktree’s development services are already running.');
  // Secrets are loaded into child-process memory, never copied into worktree env files.
  Object.assign(process.env, await isolatedRuntime());
  writeFileSync(devPidPath, String(process.pid), { mode: 0o600 });
  process.on('exit', () => rmSync(devPidPath, { force: true }));
}

const directory = fileURLToPath(new URL('..', import.meta.url));
// Share pinned local runtimes; every worktree has its own queue and task data.
const commonGitDirectory = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: directory, encoding: 'utf8' }).trim();
const primaryDirectory = dirname(commonGitDirectory);
if (primaryDirectory !== directory) {
  for (const name of ['beat-tracking', 'beat-tracking-models', 'scene-detection', 'video-import']) {
    const source = join(primaryDirectory, '.data', name), target = join(directory, '.data', name);
    if (!existsSync(target) && existsSync(source)) {
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(source, target, 'dir');
    }
  }
}
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

function start(name, command, { required = true, filter, onLine } = {}) {
  const child = spawn(process.execPath, command, { cwd: directory, stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  children.add(child);
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', line => {
      for (const output of filter ? filter(line) : [line]) console.log(`[${name}] ${new Date().toISOString()} ${output}`);
      onLine?.(line);
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
let workerStarted = false;
start('web', ['node_modules/next/dist/bin/next', 'dev', '--hostname', 'localhost', ...(!hasPort ? ['--port', port] : []), ...args], {
  onLine: line => {
    // A duplicate port or dev-directory lock must never leave a claimed task
    // behind when its frontend immediately exits and stops the worker.
    if (!stopping && !workerStarted && line.includes('Ready in ')) {
      workerStarted = true;
      start('worker', ['--env-file=.env.local', '--import', 'tsx', 'scripts/media-worker.ts']);
    }
  },
});
console.log('[ai] Watching structured AI cost logs from the Convex development deployment (read only).');
start('ai', ['node_modules/convex/bin/main.js', 'logs', '--history', '0', '--jsonl'], { required: false, filter: aiCostLines });
