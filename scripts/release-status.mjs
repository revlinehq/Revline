// What is on production: one file, one command.
//   npm run release:status                      table of every target, its deployed commit and how far it is behind HEAD;
//                                               Railway targets show the commit each slot actually runs, read live
//   npm run release:status -- --recorded        only the recorded state (no Convex or Railway access)
//   npm run release:status -- --set all=<sha>   record a commit (bootstrapping on the Mac, or after a manual deploy)
//   npm run release:status -- --set convex=<sha> --set frontend=<sha>
// scripts/release-prod.mjs writes the same file after each target it releases.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Release order. Each has its own deployed commit, so a target that failed last time is released next time. */
export const TARGETS = ['processor', 'convex', 'media', 'frontend', 'agent', 'mcp', 'exports', 'incident-listener'];
export const TARGET_NOTES = {
  processor: 'Railway media processor image', convex: 'Convex different-gnu-398', media: 'media Worker', frontend: 'frontend Worker (tryrevline.com)',
  agent: 'agent runner Worker', mcp: 'MCP Worker', exports: 'Railway export workers', 'incident-listener': 'incident publisher checkout on this Mac',
};
export const stateFile = () => resolve(process.env.REVLINE_RELEASE_STATE || '.data/production-releases/deployed.json');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const short = commit => commit ? commit.slice(0, 8) : 'unknown';

/** { targets: { <target>: { commit, at, version? } } }; null when nothing was ever recorded. */
export async function readState() {
  let text;
  try { text = await readFile(stateFile(), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const state = JSON.parse(text);
  if (!state || typeof state.targets !== 'object') throw new Error(`${stateFile()} is not a release state file.`);
  return state;
}
export async function recordTarget(target, entry) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown release target: ${target}`);
  const state = await readState() ?? { targets: {} };
  state.targets[target] = entry;
  const file = stateFile();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
/** One aligned table for the terminal. */
export function table(headers, rows) {
  const all = [headers, ...rows].map(row => row.map(cell => String(cell)));
  const widths = headers.map((_, column) => Math.max(...all.map(row => row[column].length)));
  const line = row => row.map((cell, column) => column === row.length - 1 ? cell : cell.padEnd(widths[column])).join('  ').trimEnd();
  return [line(all[0]), widths.map(width => '-'.repeat(width)).join('  '), ...all.slice(1).map(line)].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { set: { type: 'string', multiple: true }, json: { type: 'boolean' }, recorded: { type: 'boolean' } } });
  for (const item of values.set ?? []) {
    const [name, revision] = item.split('=');
    if (!revision || (name !== 'all' && !TARGETS.includes(name))) throw new Error(`Usage: --set <${TARGETS.join('|')}|all>=<commit>`);
    const commit = git('rev-parse', `${revision}^{commit}`);
    for (const target of name === 'all' ? TARGETS : [name]) await recordTarget(target, { commit, at: new Date().toISOString(), note: 'recorded by hand with release:status --set' });
    console.log(`Recorded ${name} = ${short(commit)} in ${stateFile()}.`);
  }
  const state = await readState();
  // Railway deploys itself from GitHub main, so the recorded commit is only what the last release saw: read the slots.
  const live = values.recorded || values.set?.length ? null : await liveRailway().catch(error => ({ error: error instanceof Error ? error.message.split('\n')[0] : String(error) }));
  if (values.json) { console.log(JSON.stringify({ ...(state ?? { targets: {} }), ...(live ? { railway: live } : {}) }, null, 2)); process.exit(0); }
  if (live) printLive(live);
  if (!state) {
    console.log(`No release state file at ${stateFile()}.\nNothing has been released with release:prod from this machine yet. Record what production runs once:\n  npm run release:status -- --set all=<commit on production>`);
    process.exit(0);
  }
  const head = git('rev-parse', 'HEAD');
  const behind = commit => {
    try { const count = Number(git('rev-list', '--count', `${commit}..HEAD`)); return count ? `${count} commit${count === 1 ? '' : 's'} behind HEAD` : 'at HEAD'; }
    catch { return 'commit not in this checkout (fetch origin)'; }
  };
  console.log(`Production, as recorded in ${stateFile()} (HEAD ${short(head)} on ${git('branch', '--show-current') || 'detached HEAD'}):\n`);
  console.log(table(['target', 'deployed commit', 'released at', 'against HEAD', 'what'], TARGETS.map(target => {
    const running = live?.kinds?.[target]?.commit;
    if (running) return [target, short(running), 'running now (Railway)', behind(running), TARGET_NOTES[target]];
    const entry = state.targets[target];
    return entry ? [target, short(entry.commit), entry.at, behind(entry.commit), TARGET_NOTES[target]] : [target, 'not recorded', '-', '-', TARGET_NOTES[target]];
  })));
}

/** Production's Railway slots, read live: Convex holds the slot list and the Railway token. Uses the Convex CLI's own
 *  sign-in on this machine (as release:prod does); never another session's deployment selection or key. */
async function liveRailway() {
  const { remoteEnv } = await import('./release-verify.mjs');
  const { railwayRunning, runningCommit } = await import('./release-railway.mjs');
  const env = { ...process.env };
  for (const name of ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT', 'NEXT_PUBLIC_CONVEX_URL', 'RAILWAY_API_TOKEN']) delete env[name];
  const values = await remoteEnv('different-gnu-398', env);
  if (!values.RAILWAY_WORKERS_JSON) return { error: 'production Convex has no RAILWAY_WORKERS_JSON' };
  const kinds = {};
  for (const kind of ['processor', 'exports']) {
    if (values[kind === 'processor' ? 'MEDIA_PROCESSOR_BACKEND' : 'RENDER_PROVIDER'] !== 'railway') continue;
    const slots = await railwayRunning({ values, kind });
    kinds[kind] = { commit: runningCommit(slots), slots };
  }
  return { kinds };
}

function printLive(live) {
  if (live.error) { console.log(`Railway (live): not read (${live.error}). Showing recorded commits; on the release Mac, sign in with the Convex CLI.\n`); return; }
  let main = null;
  try { main = git('rev-parse', 'origin/main'); } catch { /* no remote ref */ }
  const againstMain = commit => {
    if (!commit) return '-';
    if (!main) return 'origin/main unknown';
    try { const count = Number(git('rev-list', '--count', `${commit}..${main}`)); return count ? `${count} behind main` : 'at main'; }
    catch { return 'commit not in this checkout (fetch origin)'; }
  };
  const rows = Object.values(live.kinds).flatMap(({ slots }) => slots.map(slot => [slot.lane, slot.serviceName, short(slot.commit) + (slot.commit ? '' : slot.image ? ` (${slot.image.split('@')[1]?.slice(0, 19) ?? 'image'})` : ''), `${short(slot.latestCommit)} ${slot.latestStatus ?? 'none'}`, slot.source, againstMain(slot.commit)]));
  console.log(`Railway production (live; main ${main ? short(main) : 'unknown'} as of the last fetch):\n`);
  console.log(rows.length ? table(['lane', 'service', 'running', 'latest deployment', 'source', 'against main'], rows) : 'No lane routed to Railway.');
  console.log('');
}
