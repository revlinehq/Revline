// What is on production: one file, one command.
//   npm run release:status                      table of every target, its deployed commit and how far it is behind HEAD
//   npm run release:status -- --set all=<sha>   record a commit (bootstrapping on the Mac, or after a manual deploy)
//   npm run release:status -- --set convex=<sha> --set frontend=<sha>
//   npm run release:status -- --push            publish this file to origin's release-state branch (merged per target)
//   npm run release:status -- --pull            merge origin's release-state branch into this file
// scripts/release-prod.mjs writes the same file after each target it releases, and merges and publishes the shared
// copy, so the Mac and the GitHub release workflow plan from the same deployed commits.
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
  await writeState(state);
}
/** Replaces the whole file (used after merging the shared copy). */
export async function writeState(state) {
  const file = stateFile();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

// ---- Shared state: one JSON file on origin's release-state branch ----
// The Mac and the `Release production` workflow each keep a local state file; both merge this branch in before they
// plan and publish to it after they deploy. Per target the newer record (`at`) wins, so a rollback recorded later
// replaces the release it undid. A stale record is safe: it only makes the next plan release more, never less.
export const STATE_BRANCH = 'release-state';
const STATE_PATH = 'deployed.json';
const STATE_REF = `refs/remotes/origin/${STATE_BRANCH}`;
/** { commit, state } from origin, or null when the branch does not exist. Throws when origin cannot be reached. */
export function fetchSharedState() {
  try { execFileSync('git', ['fetch', '--quiet', 'origin', `+refs/heads/${STATE_BRANCH}:${STATE_REF}`], { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (error) {
    if (/couldn't find remote ref|not our ref/i.test(String(error.stderr))) return null;
    throw new Error(`Could not fetch origin ${STATE_BRANCH}: ${String(error.stderr).trim().split('\n').at(-1)}`);
  }
  const state = JSON.parse(git('show', `${STATE_REF}:${STATE_PATH}`));
  if (!state || typeof state.targets !== 'object') throw new Error(`origin ${STATE_BRANCH}:${STATE_PATH} is not a release state file.`);
  return { commit: git('rev-parse', STATE_REF), state };
}
export function mergeStates(...states) {
  const targets = {};
  for (const state of states) for (const [target, entry] of Object.entries(state?.targets ?? {})) {
    if (!TARGETS.includes(target) || !entry?.commit) continue;
    if (!targets[target] || Date.parse(entry.at ?? 0) > Date.parse(targets[target].at ?? 0)) targets[target] = entry;
  }
  return states.some(Boolean) ? { targets } : null;
}
/** Merges the local file into origin's release-state branch and pushes it (a new commit on that branch only; the
 *  working tree and the current branch are not touched). Retries when another release published in between. */
export async function publishState(message) {
  for (let attempt = 1; ; attempt++) {
    const shared = fetchSharedState();
    const merged = mergeStates(shared?.state, await readState());
    if (!merged) return 'nothing recorded';
    const text = JSON.stringify(merged, null, 2) + '\n';
    if (shared && JSON.stringify(shared.state, null, 2) + '\n' === text) return 'already published';
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { input: text, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['mktree'], { input: `100644 blob ${blob}\t${STATE_PATH}\n`, encoding: 'utf8' }).trim();
    const commit = git('commit-tree', tree, ...(shared ? ['-p', shared.commit] : []), '-m', message);
    try { git('push', '--quiet', 'origin', `${commit}:refs/heads/${STATE_BRANCH}`); return `published ${short(commit)}`; }
    catch (error) { if (attempt >= 3) throw new Error(`Could not push ${STATE_BRANCH}: ${String(error.stderr ?? error.message).trim().split('\n').at(-1)}`); }
  }
}

/** One aligned table for the terminal. */
export function table(headers, rows) {
  const all = [headers, ...rows].map(row => row.map(cell => String(cell)));
  const widths = headers.map((_, column) => Math.max(...all.map(row => row[column].length)));
  const line = row => row.map((cell, column) => column === row.length - 1 ? cell : cell.padEnd(widths[column])).join('  ').trimEnd();
  return [line(all[0]), widths.map(width => '-'.repeat(width)).join('  '), ...all.slice(1).map(line)].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { set: { type: 'string', multiple: true }, json: { type: 'boolean' }, push: { type: 'boolean' }, pull: { type: 'boolean' } } });
  if (values.pull) {
    const shared = fetchSharedState();
    if (!shared) console.log(`origin has no ${STATE_BRANCH} branch yet; nothing to pull.`);
    else { await writeState(mergeStates(shared.state, await readState())); console.log(`Merged origin ${STATE_BRANCH} (${short(shared.commit)}) into ${stateFile()}.`); }
  }
  for (const item of values.set ?? []) {
    const [name, revision] = item.split('=');
    if (!revision || (name !== 'all' && !TARGETS.includes(name))) throw new Error(`Usage: --set <${TARGETS.join('|')}|all>=<commit>`);
    const commit = git('rev-parse', `${revision}^{commit}`);
    for (const target of name === 'all' ? TARGETS : [name]) await recordTarget(target, { commit, at: new Date().toISOString(), note: 'recorded by hand with release:status --set' });
    console.log(`Recorded ${name} = ${short(commit)} in ${stateFile()}.`);
  }
  if (values.push) console.log(`origin ${STATE_BRANCH}: ${await publishState(`release:status --push from ${git('rev-parse', '--short', 'HEAD')}`)}.`);
  const state = await readState();
  if (values.json) { console.log(JSON.stringify(state ?? { targets: {} }, null, 2)); process.exit(0); }
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
    const entry = state.targets[target];
    return entry ? [target, short(entry.commit), entry.at, behind(entry.commit), TARGET_NOTES[target]] : [target, 'not recorded', '-', '-', TARGET_NOTES[target]];
  })));
}
