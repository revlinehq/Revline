// Copies what an editor turn reads (model settings, provider keys, media signing) from a Convex deployment to its
// Cloudflare agent runner as Worker secrets, and makes sure the two signing secrets exist. Values never touch argv,
// logs or the repository: they move through stdin and a private temp file that is removed at once.
// Usage: node scripts/sync-agent-runner-env.mjs dev|production
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (target !== 'dev' && target !== 'production') throw new Error('Usage: node scripts/sync-agent-runner-env.mjs dev|production');
const prod = ['--deployment', target === 'production' ? 'different-gnu-398' : 'majestic-alpaca-541'];
const config = join(root, 'cf-workers/agent-runner', target === 'production' ? 'wrangler.production.jsonc' : 'wrangler.jsonc');
/** Read by the turn (lib/ai, convex/lib/editorToolkit.ts, convex/lib/media_storage.ts). Add a name when the turn starts reading it. */
const TURN_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'GOOGLE_GENERATIVE_AI_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_VIDEO_MODEL', 'GEMINI_FRAME_MODEL',
  'EDITOR_DEFAULT_MODEL', 'EDITOR_DEFAULT_EFFORT', 'EDITOR_ENFORCE_TOKEN_BUDGET', 'EDITOR_INTERNAL_DETAILS_ENABLED', 'EDITOR_ALLOW_OPUS', 'EDITOR_EFFORT_SWITCHER', 'EDITOR_MODEL_CHOICE_OPEN',
  'MODEL_SWITCHER_ENABLED', 'AI_COST_DASHBOARD_ENABLED', 'AI_GATEWAY_ENABLED', 'MEDIA_WORKER_URL', 'MEDIA_SIGNING_SECRET', 'MCP_PUBLIC_ORIGIN', 'APP_ORIGIN'];

const run = (command, args, input) => new Promise((accept, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? accept(output) : reject(new Error(`${command} ${args[0]} ${args[1] ?? ''} failed (${code}).`)));
  child.stdin.end(input ?? '');
});
const convex = (...args) => run('npx', ['convex', ...args, ...prod]);

const listed = await convex('env', 'list');
const values = Object.fromEntries(listed.split('\n').flatMap(line => { const at = line.indexOf('='); return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : []; }));
// AGENT_RUNNER_SECRET signs calls both ways; AGENT_RUNNER_RUN_KEY issues run tokens and never leaves Convex.
for (const name of ['AGENT_RUNNER_SECRET', 'AGENT_RUNNER_RUN_KEY']) {
  if (values[name]) continue;
  if (dryRun) { console.log(`${name} would be created on ${target}.`); continue; }
  values[name] = randomBytes(32).toString('hex');
  await run('npx', ['convex', 'env', 'set', name, ...prod], values[name]);
}
const secrets = Object.fromEntries([...TURN_ENV, 'AGENT_RUNNER_SECRET'].flatMap(name => values[name] ? [[name, values[name]]] : []));
if (dryRun) { console.log(`Validated ${Object.keys(secrets).length} runner settings on ${target}; no secrets copied or changed.`); process.exit(0); }
const directory = await mkdtemp(join(tmpdir(), 'agent-runner-env-'));
try {
  const file = join(directory, 'secrets.json');
  await writeFile(file, JSON.stringify(secrets), { mode: 0o600 });
  await run('npx', ['wrangler', 'secret', 'bulk', file, '--config', config]);
} finally { await rm(directory, { recursive: true, force: true }); }
console.log(`Agent runner (${target}) now has ${Object.keys(secrets).length} settings from Convex: ${Object.keys(secrets).sort().join(', ')}.`);
console.log(TURN_ENV.filter(name => !values[name]).length ? `Not set on Convex, so not on the runner: ${TURN_ENV.filter(name => !values[name]).join(', ')}.` : 'Every turn setting is set.');
