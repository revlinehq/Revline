import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { command, mask, redact } from './release-command.mjs';

export const convexArgs = ['node_modules/convex/bin/main.js'];
export async function remoteEnv(deployment, env) {
  const values = parseEnv(await command(process.execPath, [...convexArgs, 'env', 'list', '--deployment', deployment], { env, quiet: true }));
  mask(values);
  return values;
}
export async function verifyConvex(deployment, env) {
  const { ConvexHttpClient } = await import('convex/browser');
  const { makeFunctionReference } = await import('convex/server');
  const values = await remoteEnv(deployment, env);
  const contract = await new ConvexHttpClient(`https://${deployment}.convex.cloud`).query(makeFunctionReference('mediaTasks:processorContract'), { workerSecret: values.RENDER_WORKER_SECRET });
  const version = Number(/MEDIA_PROCESSOR_VERSION\s*=\s*(\d+)/.exec(await readFile('lib/media-analysis/processor-version.ts', 'utf8'))?.[1]);
  if (contract.processorVersion !== version) throw new Error(`${deployment}: processor functions not ready for contract ${version}.`);
  console.log(`Verified Convex ${deployment}: functions ready, contract ${version}.`);
}
export async function verifyWorker(config, output, env) {
  const version = [...output.matchAll(/(?:Current Version ID|Version ID):\s*([\da-f-]{36})/gi)].at(-1)?.[1];
  if (!version) throw new Error(`${config}: Wrangler did not report the uploaded version.`);
  const deployments = JSON.parse(await command(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deployments', 'list', '--config', config, '--json'], { env, quiet: true }));
  const latest = deployments.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  if (!latest?.versions.some(item => item.version_id === version && item.percentage === 100)) throw new Error(`${config}: uploaded Worker version is not serving 100% of traffic.`);
  console.log(`Verified Worker ${config}: ${version} serving 100%.`);
}
export async function verifyFrontend() {
  const id = (await readFile('dist/server/BUILD_ID', 'utf8')).trim();
  if (!id) throw new Error('Frontend build ID is empty.');
  for (const origin of ['https://tryrevline.com', 'https://editor.tryrevline.com']) {
    let ready = false;
    for (let attempt = 0; attempt < 18; attempt++) {
      const response = await fetch(`${origin}/?release=${encodeURIComponent(id)}`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
      if (response.ok && (await response.text()).includes(id)) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (!ready) throw new Error(`${origin}: live HTML does not contain build ID ${id}.`);
    console.log(`Verified ${origin}: live HTML contains build ID ${id}.`);
  }
}

const wrangler = 'node_modules/wrangler/bin/wrangler.js';
/** The Worker version serving 100% right now, read before a deploy so its rollback command is exact. */
export async function servingVersion(config, env) {
  const deployments = JSON.parse(await command(process.execPath, [wrangler, 'deployments', 'list', '--config', config, '--json'], { env, quiet: true }));
  const latest = deployments.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  return latest?.versions.find(item => item.percentage === 100)?.version_id ?? null;
}
/** Production health after a release. Only routes the Workers really serve:
 *  - frontend origins answer 200 (verifyFrontend checks the build ID when the frontend was released);
 *  - agent runner: GET /health -> { ok: true } (cf-workers/agent-runner/worker.ts);
 *  - media Worker has no health route: an unsigned request must be refused with 401 JSON by its own code
 *    (cf-workers/media/worker.ts), which proves the Worker is serving and its signing check runs;
 *  - MCP Worker: its OAuth discovery document (cf-workers/mcp/worker.ts, route tryrevline.com/.well-known/oauth-*).
 * `values` is the production Convex environment (AGENT_RUNNER_URL, MEDIA_WORKER_URL). Returns failures as text. */
export async function verifyHealth(values) {
  const failures = [];
  const get = async (name, url, ok) => {
    try {
      const response = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
      const text = await response.text();
      if (await ok(response, text)) console.log(`Healthy: ${name} (${response.status}).`);
      else failures.push(`${name}: unexpected answer ${response.status} from ${new URL(url).origin}${new URL(url).pathname}`);
    } catch (error) { failures.push(`${name}: ${redact(error.message)}`); }
  };
  const json = text => { try { return JSON.parse(text); } catch { return null; } };
  for (const origin of ['https://tryrevline.com', 'https://editor.tryrevline.com']) await get(`frontend ${origin}`, `${origin}/`, response => response.ok);
  if (values.AGENT_RUNNER_URL) await get('agent runner /health', `${values.AGENT_RUNNER_URL.replace(/\/+$/, '')}/health`, (response, text) => response.ok && json(text)?.ok === true);
  else failures.push('agent runner: AGENT_RUNNER_URL is not set on production Convex.');
  if (values.MEDIA_WORKER_URL) await get('media Worker (unsigned request refused)', `${values.MEDIA_WORKER_URL.replace(/\/+$/, '')}/read`, (response, text) => response.status === 401 && typeof json(text)?.error === 'string');
  else failures.push('media Worker: MEDIA_WORKER_URL is not set on production Convex.');
  await get('MCP Worker OAuth discovery', 'https://tryrevline.com/.well-known/oauth-authorization-server', (response, text) => response.ok && !!json(text)?.token_endpoint);
  return failures;
}
/** What a cross-version break looks like in Convex logs: a caller sending arguments the new functions reject
 * (or the reverse), a caller of a function that no longer exists, a worker whose secret is refused
 * (convex/lib/media_task_auth.ts), and a processor asked for a read mode or task kind it does not know. */
export const RELEASE_LOG_PATTERNS = [
  ['argument validation', /ArgumentValidationError|ReturnsValidationError/],
  ['missing function', /Could not find public function/],
  ['worker authentication', /Media worker authentication required/],
  ['unknown mode or kind', /(unknown|unsupported|unrecognized) (read )?(mode|task kind|kind)/i],
];
/** Reads production logs for a bounded time (`convex logs` tails forever, so the child is killed), keeps events
 * at or after `since` (ms) and returns the lines matching RELEASE_LOG_PATTERNS as { kind, at (ms), signature, text },
 * redacted and shortened. */
export function scanConvexLogs(deployment, env, { since = 0, seconds = 30, history = 500 } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [...convexArgs, 'logs', '--deployment', deployment, '--history', String(history), '--jsonl'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), seconds * 1000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      const lines = output.split('\n').filter(Boolean);
      // Killed by the timer is the normal end. An early exit with nothing read means the logs were not readable.
      if (code !== null && code !== 0 && !lines.length) return reject(new Error(`Could not read ${deployment} logs: ${redact(errors).trim().slice(-300) || `exit ${code}`}`));
      const hits = [];
      for (const line of lines) {
        let at;
        try { const seconds = JSON.parse(line).timestamp; if (typeof seconds === 'number') at = seconds * 1000; } catch { /* not an event line */ }
        if (at !== undefined && at < since) continue;
        const kind = RELEASE_LOG_PATTERNS.find(([, pattern]) => pattern.test(line))?.[0];
        // signature: the kind of failure and the function it happened in, so the caller can tell new from old.
        if (kind) hits.push({ kind, at, signature: `${kind} in ${/"(?:udfPath|identifier|function|path)"\s*:\s*"([^"]+)"/.exec(line)?.[1] ?? /\b[A-Za-z_][\w/]*:[A-Za-z_]\w*\b/.exec(line)?.[0] ?? 'unknown function'}`, text: `${kind}: ${redact(line).slice(0, 400)}` });
      }
      accept({ read: lines.length, hits });
    });
  });
}
