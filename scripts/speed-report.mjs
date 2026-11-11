// Where assistant runs spend their time, from the per-step timing rows (convex/runTimings.ts): slowest tools, most
// repeated calls and the median run time per lane. Reads names, durations and token counts only; no user content.
// Usage: npm run incidents:speed -- --env dev|prod|isolated [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--runs] [--json] [--credentials-dir PATH]
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  env: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, runs: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
  'credentials-dir': { type: 'string' }, help: { type: 'boolean', default: false },
} });
if (values.help || !['dev', 'prod', 'isolated'].includes(values.env)) {
  console.log('Usage: npm run incidents:speed -- --env dev|prod|isolated [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--runs] [--json] [--credentials-dir PATH]\n  --env isolated reads this worktree\'s own isolated backend. --runs adds one step table per run.');
  process.exit(values.help ? 0 : 1);
}
const day = (text, fallback) => { if (!text) return fallback; const time = Date.parse(`${text}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(time)) throw new Error('Dates are YYYY-MM-DD.'); return time; };
const to = values.to ? day(values.to) + 24 * 60 * 60_000 : Date.now(), from = day(values.from, to - 7 * 24 * 60 * 60_000);
if (from >= to) throw new Error('--from must be before --to.');

const target = values.env, shared = { dev: 'majestic-alpaca-541', prod: 'different-gnu-398' };
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`, CI: '1' };
// Selection and backend authentication come exclusively from the chosen existing file.
for (const key of Object.keys(env)) if (/^CONVEX_|^NEXT_PUBLIC_CONVEX_/.test(key)) delete env[key];
const run = (command, argv) => new Promise((accept, reject) => {
  const child = spawn(command, argv, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  // CLI errors may contain credentials. Never echo them.
  child.stderr.resume();
  child.on('error', () => reject(new Error(`${command} could not start.`)));
  child.on('close', code => code === 0 ? accept(stdout.trim()) : reject(new Error(`${command} failed (exit ${code ?? 'signal'}).`)));
});
let credentialsDir = root;
if (target !== 'isolated') {
  const primary = (await run('git', ['worktree', 'list', '--porcelain'])).split('\n').find(line => line.startsWith('worktree '))?.slice('worktree '.length);
  if (!primary) throw new Error('Cannot locate the main worktree for existing deployment credentials.');
  credentialsDir = resolve(values['credentials-dir'] ?? primary);
}
const envFile = join(credentialsDir, target === 'prod' ? '.env.production.local' : '.env.local');
const config = parseEnv(await readFile(envFile, 'utf8').catch(() => { throw new Error(`The ${target} environment file is missing. Use --credentials-dir.`); }));
const name = (config.CONVEX_DEPLOYMENT ?? '').split(':')[1] ?? '';
if (target === 'isolated' ? !config.CONVEX_DEPLOYMENT?.startsWith('dev:') || Object.values(shared).includes(name) : config.CONVEX_DEPLOYMENT !== `${target}:${shared[target]}`) throw new Error('Environment selection does not match the expected deployment.');
if (config.CONVEX_SELF_HOSTED_URL || config.CONVEX_SELF_HOSTED_ADMIN_KEY) throw new Error('Self-hosted overrides are not supported.');

const runs = [];
for (let cursor = null; ;) {
  const page = JSON.parse(await run('npx', ['--no-install', 'convex', 'run', 'runTimings:range', JSON.stringify({ from, to, cursor, limit: 100 }), '--env-file', envFile, ...(target === 'prod' ? ['--prod'] : [])]));
  runs.push(...page.runs);
  if (!(cursor = page.cursor)) break;
}

// Kept in step with RENDERING_TOOLS in lib/ai/step-timing.ts.
const RENDERING = new Set(['getFrames', 'readFrames', 'inspectFrames', 'inspectVideo', 'checkSpots', 'checkPacing', 'checkSound', 'getSound', 'checkClip', 'previewRender', 'finish', 'readScript', 'detectFacecam', 'followSubject', 'normalizeAudio', 'exportVideo']);
const median = list => { if (!list.length) return 0; const sorted = [...list].sort((a, b) => a - b), middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const seconds = ms => (ms / 1000).toFixed(1), share = (part, whole) => whole ? `${Math.round(100 * part / whole)}%` : '0%';
const pad = (text, width) => String(text).padEnd(width), right = (text, width) => String(text).padStart(width);

const summarize = run => {
  const steps = [...run.steps].sort((a, b) => a.at - b.at), first = steps[0]?.at ?? run.startedAt, last = Math.max(...steps.map(step => step.at + step.ms), first);
  const model = steps.filter(step => step.kind === 'model'), tools = steps.filter(step => step.kind === 'tool');
  const sum = (list, key) => list.reduce((total, step) => total + (step[key] ?? 0), 0);
  // The same tool with the same arguments again, with no other tool call in between: a repeat that changed nothing.
  let repeats = 0;
  for (let index = 1; index < tools.length; index++) if (tools[index].name === tools[index - 1].name && tools[index].key && tools[index].key === tools[index - 1].key) repeats++;
  const modelMs = sum(model, 'ms'), toolMs = sum(tools, 'ms'), wall = last - first;
  return { runId: run.runId, source: run.source, lane: run.lane ?? 'unknown', model: run.model ?? (run.source === 'mcp' ? 'external agent' : 'unknown'), effort: run.effort ?? '', startedAt: first, wall, modelMs, toolMs,
    // Wall time not inside a model call or a tool call: round trips, queueing and saves between steps (for MCP: the agent's own thinking).
    otherMs: Math.max(0, wall - modelMs - toolMs), modelCalls: model.length, toolCalls: tools.length, failed: tools.filter(step => step.failed).length, repeats,
    renderMs: sum(tools.filter(step => RENDERING.has(step.name)), 'ms'), inputTokens: sum(model, 'inputTokens'), outputTokens: sum(model, 'outputTokens'), cacheReadTokens: sum(model, 'cacheReadTokens'), cacheWriteTokens: sum(model, 'cacheWriteTokens'), steps };
};
const summaries = runs.map(summarize);
const byTool = new Map();
for (const run of summaries) for (const step of run.steps) if (step.kind === 'tool') {
  const row = byTool.get(step.name) ?? byTool.set(step.name, { name: step.name, calls: 0, ms: 0, times: [], failed: 0, runs: new Set() }).get(step.name);
  row.calls++; row.ms += step.ms; row.times.push(step.ms); row.runs.add(run.runId); if (step.failed) row.failed++;
}
const totalWall = summaries.reduce((total, run) => total + run.wall, 0);
const tools = [...byTool.values()].map(row => ({ name: row.name, calls: row.calls, runs: row.runs.size, totalMs: row.ms, medianMs: median(row.times), maxMs: Math.max(...row.times), failed: row.failed, renders: RENDERING.has(row.name) })).sort((a, b) => b.totalMs - a.totalMs);
const lanes = [...new Set(summaries.map(run => `${run.source}/${run.lane}/${run.model}${run.effort ? `/${run.effort}` : ''}`))].map(key => {
  const group = summaries.filter(run => `${run.source}/${run.lane}/${run.model}${run.effort ? `/${run.effort}` : ''}` === key);
  return { key, runs: group.length, medianWallMs: median(group.map(run => run.wall)), medianModelMs: median(group.map(run => run.modelMs)), medianToolMs: median(group.map(run => run.toolMs)), medianOtherMs: median(group.map(run => run.otherMs)), medianSteps: median(group.map(run => run.modelCalls)), medianToolCalls: median(group.map(run => run.toolCalls)) };
}).sort((a, b) => b.medianWallMs - a.medianWallMs);
const repeated = new Map();
for (const run of summaries) { const seen = new Map(); for (const step of run.steps) if (step.kind === 'tool' && step.key) seen.set(`${step.name}:${step.key}`, (seen.get(`${step.name}:${step.key}`) ?? 0) + 1); for (const [key, times] of seen) if (times > 1) { const name = key.split(':')[0], row = repeated.get(name) ?? repeated.set(name, { name, extraCalls: 0, runs: 0 }).get(name); row.extraCalls += times - 1; row.runs++; } }
const repeats = [...repeated.values()].sort((a, b) => b.extraCalls - a.extraCalls);

if (values.json) { console.log(JSON.stringify({ deployment: name, from: new Date(from).toISOString(), to: new Date(to).toISOString(), runs: summaries.length, lanes, tools, repeats, ...(values.runs ? { perRun: summaries } : {}) }, null, 2)); process.exit(0); }
console.log(`Assistant speed on ${target} (${name}), ${new Date(from).toISOString().slice(0, 10)} to ${new Date(to - 1).toISOString().slice(0, 10)}: ${summaries.length} run${summaries.length === 1 ? '' : 's'}, ${seconds(totalWall)} s in all.`);
if (!summaries.length) { console.log('No timed runs in this range. Timing is recorded from the release that added convex/runTimings.ts.'); process.exit(0); }
console.log(`\nMedian run per lane (source/lane/model/effort)\n${pad('lane', 52)}${right('runs', 5)}${right('wall s', 9)}${right('model s', 9)}${right('tools s', 9)}${right('other s', 9)}${right('steps', 7)}${right('tools', 7)}`);
for (const lane of lanes) console.log(`${pad(lane.key, 52)}${right(lane.runs, 5)}${right(seconds(lane.medianWallMs), 9)}${right(seconds(lane.medianModelMs), 9)}${right(seconds(lane.medianToolMs), 9)}${right(seconds(lane.medianOtherMs), 9)}${right(lane.medianSteps, 7)}${right(lane.medianToolCalls, 7)}`);
console.log(`\nSlowest tools by total time (* draws frames or decodes media)\n${pad('tool', 30)}${right('calls', 7)}${right('runs', 6)}${right('total s', 9)}${right('share', 7)}${right('median s', 10)}${right('max s', 8)}${right('failed', 8)}`);
for (const tool of tools.slice(0, 25)) console.log(`${pad(`${tool.name}${tool.renders ? ' *' : ''}`, 30)}${right(tool.calls, 7)}${right(tool.runs, 6)}${right(seconds(tool.totalMs), 9)}${right(share(tool.totalMs, totalWall), 7)}${right(seconds(tool.medianMs), 10)}${right(seconds(tool.maxMs), 8)}${right(tool.failed, 8)}`);
console.log(`\nMost repeated calls (same tool, same arguments, again in one run)\n${pad('tool', 30)}${right('extra calls', 12)}${right('runs', 6)}`);
for (const row of repeats.slice(0, 15)) console.log(`${pad(row.name, 30)}${right(row.extraCalls, 12)}${right(row.runs, 6)}`);
if (!repeats.length) console.log('none');
if (values.runs) for (const run of summaries) {
  console.log(`\nRun ${run.runId.slice(-12)} · ${run.source}/${run.lane}/${run.model}${run.effort ? `/${run.effort}` : ''} · ${new Date(run.startedAt).toISOString()} · wall ${seconds(run.wall)} s (model ${seconds(run.modelMs)}, tools ${seconds(run.toolMs)}, other ${seconds(run.otherMs)}) · tokens in ${run.inputTokens} (cache read ${run.cacheReadTokens}, write ${run.cacheWriteTokens}) out ${run.outputTokens}`);
  console.log(`${right('step', 5)} ${pad('what', 28)}${right('start s', 9)}${right('s', 8)}${right('share', 7)}${right('gap s', 8)}  notes`);
  let previousEnd = run.startedAt;
  for (const step of run.steps) {
    const notes = step.kind === 'model' ? `in ${step.inputTokens ?? '?'} (cached ${step.cacheReadTokens ?? 0}) out ${step.outputTokens ?? '?'}${step.firstOutputMs !== undefined ? ` first output ${seconds(step.firstOutputMs)} s` : ''}` : `${RENDERING.has(step.name) ? 'renders' : ''}${step.failed ? ' failed' : ''}`;
    console.log(`${right(step.step, 5)} ${pad(step.kind === 'model' ? 'model call' : step.name, 28)}${right(seconds(step.at - run.startedAt), 9)}${right(seconds(step.ms), 8)}${right(share(step.ms, run.wall), 7)}${right(seconds(Math.max(0, step.at - previousEnd)), 8)}  ${notes}`);
    previousEnd = Math.max(previousEnd, step.at + step.ms);
  }
}
