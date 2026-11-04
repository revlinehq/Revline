import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
export const shared = 'majestic-alpaca-541';
export const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
export const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
export const primary = dirname(common);
export const readEnv = path => existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
export const localEnv = () => readEnv(join(root, '.env.local'));
export const statePath = join(root, '.data/isolated/state.json');
export const devPidPath = join(root, '.data/isolated/dev.pid');
export function runningDev() {
  if (!existsSync(devPidPath)) return null;
  const pid = Number(readFileSync(devPidPath, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid isolated development PID file.');
  try { process.kill(pid, 0); return pid; } catch (error) { if (error.code === 'ESRCH') return null; throw error; }
}
export const readState = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
export function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
export function writeEnv(values) {
  writeFileSync(join(root, '.env.local'), Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
}
export function envLine(key, value) {
  // dotenv does not unescape \". Use a delimiter absent from the value instead.
  const quote = ["'", '`'].find(quote => !value.includes(quote));
  return quote && !value.includes('\r') ? `${key}=${quote}${value}${quote}` : null;
}
// Capture BOTH streams: commands that handle credentials must never echo them on failures.
export function run(args, { env = {}, input = '', cwd = root } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return accept(stdout);
      const error = new Error(`Command ${args.slice(0, 3).join(' ')} failed (${code}); output withheld because it may contain credentials.`);
      error.stderr = stderr;
      reject(error);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
export const convex = (args, options) => run([join(root, 'node_modules/convex/bin/main.js'), ...args], options);
export const sourceConvex = args => {
  const read = args[0] === 'data' || args[0] === 'function-spec' || args[0] === 'env' && args[1] === 'list' || args[0] === 'run' && args[1] === 'assets:list' && !args.includes('--push');
  if (!read) throw new Error('Shared dev access from isolation setup is read-only.');
  return convex([...args, '--deployment', shared, '--env-file', '/dev/null'], { env: { CONVEX_DEPLOY_KEY: '', CONVEX_DEPLOYMENT_TOKEN: '' } });
};
export async function sourceValues() {
  return parseEnv(await sourceConvex(['env', 'list']));
}
export async function platform(path, { method = 'GET', body } = {}) {
  // The same personal CLI login used by `convex deployment create`; never a prod deploy key.
  const { accessToken } = JSON.parse(readFileSync(join(homedir(), '.convex/config.json'), 'utf8'));
  const response = await fetch(`https://api.convex.dev/v1${path}`, {
    method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Convex management ${method} ${path} failed (${response.status}); response withheld.`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export function assertIsolated(state = readState()) {
  const env = { ...localEnv(), ...process.env };
  if (!state || state.root !== root || state.name === shared || env.CONVEX_DEPLOYMENT !== `dev:${state.name}` || !env.CONVEX_DEPLOY_KEY?.startsWith(`dev:${state.name}|`) || env.NEXT_PUBLIC_CONVEX_URL !== `https://${state.name}.convex.cloud`) {
    throw new Error('This worktree is not isolated. Run npm run dev:isolated first. Shared dev belongs only to main.');
  }
  return state;
}
export async function isolatedRuntime() {
  const state = assertIsolated();
  const settings = parseEnv(await convex(['env', 'list']));
  const main = readEnv(resolve(process.env.REVLINE_MAIN_ENV ?? join(primary, '.env.local')));
  if (!main.CLERK_SECRET_KEY?.startsWith('sk_test_') || !main.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')) throw new Error('Isolated development requires Clerk development keys in the primary checkout.');
  return { ...settings, ...localEnv(), CLERK_SECRET_KEY: main.CLERK_SECRET_KEY, PORT: String(state.port) };
}
