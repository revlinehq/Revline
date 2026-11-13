// One command for a production release, run on the Mac that holds the production credentials:
//   npm run release:prod                      release what changed since each target's deployed commit
//   npm run release:prod -- --dry-run         print the plan; works on any machine, changes nothing
// The `Release production` workflow (.github/workflows/release-production.yml) runs this same command on every push to
// main with REVLINE_RELEASE_CI=1: Convex and the Cloudflare Workers only, credentials from the GitHub `production`
// environment instead of the Mac (see "CI mode" below and docs/releases.md).
// Flags: --base <commit> (comparison commit for targets with no recorded release), --only <target,…>,
//   --auto-rollback (roll Workers back when verification fails), --no-changelog. (--founder-bypass is accepted and
//   ignored: Railway is no longer promoted from staging.)
// It only orders and records: the planner (release-plan.mjs), the verifiers (release-verify.mjs), the
// agent settings sync and the Worker configs. Railway deploys itself from GitHub main; this command only reads which
// commit it runs (release-railway.mjs) and holds Convex while a raised processor contract is not running yet.
// Production only. The development deployment (majestic-alpaca-541) is never touched.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { command, mask, redact } from './release-command.mjs';
import { STATE_BRANCH, TARGETS, TARGET_NOTES, fetchSharedState, mergeStates, publishState, readState, recordTarget, short, stateFile, table, writeState } from './release-status.mjs';

const { values: flags } = parseArgs({ options: {
  'dry-run': { type: 'boolean' }, base: { type: 'string' }, only: { type: 'string' }, 'auto-rollback': { type: 'boolean' },
  'founder-bypass': { type: 'string' }, 'no-changelog': { type: 'boolean' },
} });
const dry = !!flags['dry-run'];
const DEPLOYMENT = 'different-gnu-398';
const LISTENER = 'com.revline.incident-issues-prod';
const CONTRACT_FILE = 'lib/media-analysis/processor-version.ts';
const WRANGLER = 'node_modules/wrangler/bin/wrangler.js';
const CONVEX = 'node_modules/convex/bin/main.js';
const WORKERS = {
  media: 'cf-workers/media/wrangler.production.jsonc', frontend: 'dist/server/wrangler.json',
  agent: 'cf-workers/agent-runner/wrangler.production.jsonc', mcp: 'cf-workers/mcp/wrangler.production.jsonc',
};
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sha = git('rev-parse', 'HEAD');
// CI mode: the GitHub release workflow on a hosted runner. It deploys Convex and the Cloudflare Workers and, like the
// Mac, only reads which commit Railway runs (Railway deploys itself from GitHub main). The incident listener lives on
// the Mac. Everything else is this same command.
const ci = process.env.REVLINE_RELEASE_CI === '1';
const CI_TARGETS = ['processor', 'convex', 'media', 'frontend', 'agent', 'mcp', 'exports'];
const only = flags.only ? flags.only.split(',').map(name => name.trim()).filter(Boolean) : ci ? CI_TARGETS : TARGETS;
for (const name of only) if (!TARGETS.includes(name)) throw new Error(`--only takes ${TARGETS.join(', ')}; got "${name}".`);
if (ci) for (const name of only) if (!CI_TARGETS.includes(name)) throw new Error(`The release workflow runs only ${CI_TARGETS.join(', ')}; "${name}" is released from the Mac.`);
if (flags['founder-bypass'] !== undefined) console.log('--founder-bypass ignored: Railway deploys from GitHub main and is not promoted from staging.');

const productionFile = resolve(process.env.REVLINE_PRODUCTION_ENV_FILE || '.env.production.local');
// railway-workers.mjs reads the Railway token and registry credentials from its own env file when one is kept.
const railwayFile = resolve(process.env.REVLINE_RAILWAY_PRODUCTION_ENV_FILE || (existsSync('.data/railway/production.env') ? '.data/railway/production.env' : productionFile));
const lockFile = resolve('.data/production-releases/release.lock');

// Never inherit a deployment selection or provider token from another session (as release-main.mjs does).
// CLOUDFLARE_API_TOKEN is kept: on the Mac, Wrangler signs in either with it or with `wrangler login`, and every
// Worker config pins the production account_id, so a token for another account fails instead of deploying elsewhere.
const env = { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' };
for (const name of Object.keys(env)) if (name.startsWith('FLY_')) delete env[name];
// In CI mode the deploy key is read from the production env file and given only to Convex calls (convexEnv below),
// never to the builds.
for (const name of ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT', 'NEXT_PUBLIC_CONVEX_URL', 'RAILWAY_API_TOKEN', 'REVLINE_FRONTEND_ENV_FILE', 'REVLINE_ENV_FILE', 'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_SHA']) delete env[name];
// scripts/cloudflare-frontend.mjs builds from .env.production.local in the checkout, the Mac's documented frontend
// source (release-main.mjs refuses that file on the PC because the PC's copy is the processor/Convex file and Vite
// loads it into the build). When the file lives elsewhere, point the frontend build at it explicitly.
// In CI mode the production file holds only the Convex target and key: the frontend build reads the committed public
// settings in wrangler.jsonc plus the NEXT_PUBLIC_* variables the workflow passes from the `production` environment.
if (process.env.REVLINE_PRODUCTION_ENV_FILE && !ci) env.REVLINE_FRONTEND_ENV_FILE = productionFile;
let convexEnv = env;

// ---- Plan: every target against its own deployed commit ----
// The deployed commits are shared between the Mac and the release workflow on origin's release-state branch.
let shared = null, sharedError = null;
try { shared = fetchSharedState(); } catch (error) { sharedError = error.message; }
const state = mergeStates(await readState(), shared?.state);
const baseCommit = flags.base ? git('rev-parse', `${flags.base}^{commit}`) : null;
const deployedOf = target => state?.targets?.[target]?.commit ?? baseCommit;
const { releasePlan } = await import('./release-plan.mjs');
const plans = new Map();
const planFor = commit => {
  const key = commit ?? '';
  if (!plans.has(key)) {
    if (commit) { try { git('cat-file', '-e', `${commit}^{commit}`); } catch { throw new Error(`Deployed commit ${commit} is not in this checkout. Run git fetch origin, or correct it with release:status --set.`); } }
    plans.set(key, releasePlan(commit ?? undefined));
  }
  return plans.get(key);
};
const SERVICE = { processor: 'processor', convex: 'convex', media: 'media', frontend: 'frontend', agent: 'agent', mcp: 'mcp', exports: 'exports' };
const rows = new Map();
for (const target of TARGETS) {
  const old = deployedOf(target) ?? null;
  let changed, files = [];
  // The listener checkout follows main: it is updated whenever it is behind the release commit.
  if (target === 'incident-listener') changed = old !== sha;
  else { const service = planFor(old).services[SERVICE[target]]; changed = service.changed; files = service.files; }
  rows.set(target, { old, changed, files, selected: only.includes(target), result: !only.includes(target) ? (ci && !flags.only ? 'skipped: released from the Mac' : 'skipped: not in --only') : changed ? (dry ? 'would release' : 'pending') : 'unchanged' });
}
const want = target => rows.get(target).selected && rows.get(target).changed;
const setResult = (target, result) => { rows.get(target).result = result; };
const known = TARGETS.map(deployedOf).filter(Boolean);
// The compatibility check starts from the oldest commit still serving anywhere.
const oldest = known.length ? known.reduce((a, b) => Number(git('rev-list', '--count', `${a}..HEAD`)) >= Number(git('rev-list', '--count', `${b}..HEAD`)) ? a : b) : null;
/** The processor contract number differs between the processor production runs (`from`) and this commit. */
const contractRaised = (from = deployedOf('processor')) => !from || planFor(from).files.includes(CONTRACT_FILE);

function printTable() {
  console.log(`\nProduction release ${short(sha)}${dry ? ' (DRY RUN: nothing was deployed)' : ''}\n`);
  console.log(table(['target', 'old → new commit', 'result'], TARGETS.map(target => {
    const row = rows.get(target);
    const moves = row.selected && row.changed;
    return [target, `${short(row.old)} → ${moves ? short(sha) : short(row.old)}`, row.result];
  })));
}

/** Why a real run would stop on this machine, without any network call. */
async function localRefusals() {
  const reasons = [];
  if (ci) {
    // The workflow's own guard repeats these; this one also stops a copied command on another runner or branch.
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main') reasons.push('CI mode runs only in the GitHub release workflow on main');
    if (existsSync('.env.production.local')) reasons.push('the CI checkout must not hold .env.production.local (Vite would load it into the frontend build)');
    if (!state && !baseCommit) reasons.push(`no deployed commit is recorded on origin ${STATE_BRANCH} and no --base was given; publish the Mac's state once (npm run release:status -- --push) or run the workflow by hand with a base commit`);
  } else if (process.platform !== 'darwin') reasons.push(`this is ${process.platform}; production releases run on the Mac that holds the production credentials`);
  // The Mac is the fallback when GitHub misbehaves, so there it only warns (its local file still plans safely).
  if (sharedError && ci) reasons.push(`the shared release state could not be read (${sharedError})`);
  try {
    const production = parseEnv(await readFile(productionFile, 'utf8'));
    if (ci && !production.CONVEX_DEPLOY_KEY?.startsWith(`prod:${DEPLOYMENT}|`)) reasons.push(`the CI production file has no production deploy key for ${DEPLOYMENT}`);
    if (production.CONVEX_DEPLOYMENT !== `prod:${DEPLOYMENT}` || production.NEXT_PUBLIC_CONVEX_URL !== `https://${DEPLOYMENT}.convex.cloud`) reasons.push(`${productionFile} does not target prod:${DEPLOYMENT} and https://${DEPLOYMENT}.convex.cloud`);
  } catch (error) { reasons.push(error.code === 'ENOENT' ? `the production environment file is missing (${productionFile})` : `${productionFile} could not be read`); }
  const branch = git('branch', '--show-current');
  if (branch !== 'main') reasons.push(`the checkout is on ${branch || 'a detached HEAD'}, not main`);
  if (git('status', '--porcelain')) reasons.push('the checkout has uncommitted or untracked changes');
  return reasons;
}

const compatScript = 'scripts/compat-check.mjs', changelogScript = 'scripts/changelog.mjs';

if (dry) {
  const refusals = await localRefusals();
  console.log(`Target: PRODUCTION (Convex ${DEPLOYMENT}, Cloudflare Workers${ci ? '; CI mode' : ''}; Railway deploys itself and is only read). Dry run: no deploys, no credentials used.`);
  console.log(`Release commit: ${sha} (${git('log', '-1', '--format=%s')})`);
  console.log(sharedError ? `Shared release state not read: ${sharedError}` : `Shared release state: ${shared ? `origin ${STATE_BRANCH} ${short(shared.commit)}` : `origin has no ${STATE_BRANCH} branch yet`}, merged with ${stateFile()}.`);
  console.log(state ? `Deployed commits: ${stateFile()}${shared ? ` and origin ${STATE_BRANCH}` : ''}` : `No release state at ${stateFile()}; ${baseCommit ? `comparing every target with --base ${short(baseCommit)}` : 'no --base given, so every target counts as changed (full release)'}.`);
  console.log(refusals.length ? `A real run would refuse here: ${refusals.join('; ')}.` : 'A real run would pass the local guard here; it would still fetch origin and require HEAD to equal origin/main.');
  console.log('\nChanged files per target:');
  for (const target of TARGETS) {
    const row = rows.get(target);
    if (target === 'incident-listener') { console.log(`  ${target}: ${row.changed ? `behind the release commit (${short(row.old)})` : 'at the release commit'}`); continue; }
    console.log(`  ${target}: ${row.changed ? `${row.files.length || 'all'} file(s)${row.files.length ? `: ${row.files.slice(0, 6).join(', ')}${row.files.length > 6 ? ', …' : ''}` : ' (no recorded release)'}` : 'none'}`);
  }
  const steps = [];
  steps.push(ci ? `Guard: GitHub release workflow on main, ${productionFile} targeting prod:${DEPLOYMENT} with its production deploy key, clean, HEAD = origin/main or behind it (a commit behind still releases, unless production already runs a newer one)` : `Guard: macOS, ${productionFile} targeting prod:${DEPLOYMENT}, on main, clean, HEAD = origin/main; take ${lockFile}`);
  steps.push(oldest ? `Pre-flight: node ${compatScript} --base ${short(oldest)} --head ${short(sha)}` : 'Pre-flight: compatibility check skipped (no deployed commit recorded; pass --base)');
  const typechecks = ['typecheck', ...(want('agent') ? ['agent-runner:install', 'typecheck:agent-runner'] : []), ...(want('mcp') ? ['mcp:install', 'typecheck:mcp'] : []), ...(want('processor') || want('exports') ? ['typecheck:processor-edge'] : [])];
  steps.push(`Pre-flight: ${typechecks.map(name => `npm run ${name}`).join(', ')}`);
  if (want('frontend')) steps.push('Pre-flight: npm run build:cloudflare (the only frontend build; the deploy step uploads it)');
  if (want('processor')) steps.push(`Railway processor, if production routes processing to Railway: Railway deploys it from GitHub main by itself; read the commit each slot runs and record it${contractRaised() ? '. This range raises the processor contract: Convex and everything after it are held until the processor runs this commit' : ''}`);
  if (want('convex')) steps.push(`Convex: convex deploy --yes --typecheck enable --env-file <production file> --message ${short(sha)} (waits for index backfill and schema validation), then verify the processor contract`);
  for (const target of ['media', 'frontend', 'agent', 'mcp']) if (want(target)) steps.push(`${TARGET_NOTES[target]}: record the serving version${target === 'agent' ? ', sync settings from Convex (sync-agent-runner-env.mjs production)' : ''}, wrangler deploy --config ${WORKERS[target]}, verify 100% traffic${target === 'frontend' ? ' and the live build ID' : ''}`);
  if (want('exports')) steps.push('Railway export workers, if production routes exports to Railway: deployed from GitHub main by Railway; read the commit each slot runs, verify slot settings, record it');
  steps.push('Post-deploy: health endpoints (frontend origins, agent runner /health, media Worker refusal, MCP OAuth discovery) and a 30 s read of production Convex logs for argument-validation errors, missing functions, worker auth failures and unknown modes');
  if (want('incident-listener')) steps.push(`Incident listener: if ~/Library/LaunchAgents/${LISTENER}.plist exists, fast-forward its checkout to ${short(sha)}, npm ci when the lockfile changed, launchctl kickstart, confirm running`);
  if (!flags['no-changelog']) steps.push(`Changelog: node ${changelogScript} build, commit docs/changelog.md and docs/changelog.d to main with [skip ci]`);
  steps.push(`Record each released target in ${stateFile()} as it succeeds, then publish it to origin ${STATE_BRANCH}; print the table. On a failed verification: print the exact rollback commands and exit 1${flags['auto-rollback'] ? ' after rolling the Workers back (--auto-rollback)' : ' (no rollback without --auto-rollback)'}`);
  console.log('\nPlan, in order:');
  steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
  if (oldest && existsSync(compatScript)) {
    // Read-only and local, so the dry run answers "would the gate stop this release" too.
    const check = spawnSync(process.execPath, [compatScript, '--base', oldest, '--head', sha], { encoding: 'utf8', env });
    console.log(`\nCompatibility check ${short(oldest)}..${short(sha)}: ${check.status === 0 ? 'passes' : check.status === 1 ? 'FAILS; a real run stops before deploying anything' : `could not run (exit ${check.status})`}`);
    if (check.status !== 0) console.log(redact(`${check.stdout}${check.stderr}`).trim().split('\n').slice(-40).map(line => `  ${line}`).join('\n'));
  }
  printTable();
  process.exit(0);
}

// ---- Real run ----
const refusals = await localRefusals();
if (refusals.length) {
  console.error(`release:prod refuses to run: ${refusals.join('; ')}.\nUse --dry-run to print the plan from any checkout.`);
  process.exit(2);
}
await command('git', ['fetch', 'origin', 'main'], { env, quiet: true });
if (sharedError) console.warn(`Warning: the shared release state was not read (${sharedError}); planning from ${stateFile()} only.`);
// CI: main may have moved on while this run waited (a newer merge whose gates failed, a [skip ci] changelog commit).
// This commit is still released, unless something newer than it is already deployed (a re-run of an old run).
const tip = git('rev-parse', 'origin/main');
const isAncestor = (older, newer) => spawnSync('git', ['merge-base', '--is-ancestor', older, newer]).status === 0;
if (ci && tip !== sha && isAncestor(sha, tip)) {
  const newer = TARGETS.map(deployedOf).filter(commit => commit && commit !== sha && isAncestor(sha, commit));
  if (newer.length) { console.log(`Release ${short(sha)} skipped: production already runs the newer ${short(newer[0])}.`); process.exit(0); }
  console.log(`main has moved on to ${short(tip)}; releasing ${short(sha)} now. The run for the newer commit, if its gates pass, follows.`);
} else if (git('rev-parse', 'origin/main') !== sha) { console.error(`release:prod refuses to run: HEAD ${short(sha)} is not origin/main ${short(git('rev-parse', 'origin/main'))}. Pull main first.`); process.exit(2); }
// The Mac's lock file does not stop the release workflow, so ask GitHub whether one is deploying right now.
if (!ci) {
  const runs = spawnSync('gh', ['run', 'list', '--workflow', 'release-production.yml', '--status', 'in_progress', '--json', 'url', '--limit', '5'], { encoding: 'utf8', timeout: 20000 });
  let active = null;
  try { if (runs.status === 0) active = JSON.parse(runs.stdout || '[]'); } catch { /* treated as unknown below */ }
  if (active?.length) { console.error(`release:prod refuses to run: the Release production workflow is deploying (${active[0].url}). Wait for it, then run again.`); process.exit(2); }
  if (!active) console.warn('Warning: could not ask GitHub whether the Release production workflow is deploying (gh missing or signed out). Check before going on: gh run list --workflow release-production.yml --status in_progress');
}
const productionValues = parseEnv(await readFile(productionFile, 'utf8'));
mask(productionValues);
if (ci) convexEnv = { ...env, CONVEX_DEPLOY_KEY: productionValues.CONVEX_DEPLOY_KEY };
await mkdir(dirname(lockFile), { recursive: true, mode: 0o700 });
try { await writeFile(lockFile, `${process.pid} ${new Date().toISOString()} ${sha}\n`, { flag: 'wx', mode: 0o600 }); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.error(`release:prod refuses to run: another release holds ${lockFile} (${(await readFile(lockFile, 'utf8')).trim()}). Remove the file only if that process is gone.`);
  process.exit(2);
}
const { rmSync } = await import('node:fs');
process.on('exit', () => { try { rmSync(lockFile); } catch { /* already gone */ } });
// Every record of this run builds on what the Mac and earlier workflow runs released.
if (state) await writeState(state);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

const { convexArgs, remoteEnv, verifyConvex, verifyWorker, verifyFrontend, servingVersion, verifyHealth, scanConvexLogs } = await import('./release-verify.mjs');
const { releaseRailway, verifyRailway } = await import('./release-railway.mjs');
const node = (args, options) => command(process.execPath, args, { env, ...options });
const npm = name => command('npm', ['run', name], { env });
const step = name => console.log(`\n== ${name} ==`);
const startedAt = Date.now();
const rollbacks = [];
let failure = null, deployStartedAt = startedAt, verified = true;
const record = (target, extra = {}) => recordTarget(target, { commit: sha, at: new Date().toISOString(), ...extra });

async function worker(target, before) {
  const config = WORKERS[target];
  const previous = await servingVersion(config, env);
  if (before) await before();
  const output = await node([WRANGLER, 'deploy', '--config', config]);
  // From here the new version serves: its rollback must be printed even when verification fails.
  rollbacks.push({ target, previous, config, text: previous ? `npx wrangler rollback ${previous} --config ${config} --message "release ${short(sha)} failed verification" --yes` : `(${target}: no earlier version was serving; nothing to roll back to)` });
  await verifyWorker(config, output, env);
  if (target === 'frontend') await verifyFrontend();
  await record(target, { version: [...output.matchAll(/(?:Current Version ID|Version ID):\s*([\da-f-]{36})/gi)].at(-1)?.[1] });
  setResult(target, 'released');
}

/** Whether this checkout has `commit`; Railway may already run a main commit fetched after this release started. */
function haveCommit(commit) {
  const has = () => { try { execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };
  if (!commit || has()) return !!commit;
  try { execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { stdio: 'ignore' }); } catch { /* offline: unknown */ }
  return has();
}
/** Whether `commit` is this release's commit or a later one. */
function includesRelease(commit) {
  if (!haveCommit(commit)) return false;
  try { execFileSync('git', ['merge-base', '--is-ancestor', sha, commit], { stdio: 'ignore' }); return true; } catch { return false; }
}
// A Railway lane not (yet) at this commit: the release still finishes, but the changelog waits for a run where it is.
let railwayBehind = false;

/** Railway deploys the slots from GitHub main; read and record what they run. Returns the running commit or null. */
async function railway(kind, remote) {
  const routed = remote[kind === 'processor' ? 'MEDIA_PROCESSOR_BACKEND' : 'RENDER_PROVIDER'] === 'railway';
  if (!routed) { setResult(kind, `skipped: production does not route ${kind === 'processor' ? 'processing' : 'exports'} to Railway`); return null; }
  const running = await releaseRailway({ target: { name: 'production', deployment: DEPLOYMENT, file: railwayFile }, kind, values: remote, dry: false });
  await verifyRailway({ deployment: DEPLOYMENT, kind, values: remote });
  rollbacks.push({ target: kind, text: `Railway ${kind}: deployed from GitHub main by Railway. To roll back: redeploy an earlier deployment of each slot in the Railway dashboard (or revert on main); docs/releases.md, Rollback.` });
  const current = includesRelease(running);
  if (running && haveCommit(running)) await record(kind, { commit: running, note: 'read from Railway (GitHub autodeploy)' });
  if (!current) railwayBehind = true;
  setResult(kind, !running ? 'slots run different or unknown commits (see above)' : current ? `running ${short(running)} (Railway autodeploy)` : `running ${short(running)}, not this commit yet: Railway builds main by itself (npm run release:status); a failed or crashing build shows there`);
  return running;
}

async function incidentListener() {
  const plist = join(homedir(), 'Library/LaunchAgents', `${LISTENER}.plist`);
  if (!existsSync(plist)) { setResult('incident-listener', `skipped: ${LISTENER} is not installed on this Mac`); return; }
  const directory = (await command('plutil', ['-extract', 'WorkingDirectory', 'raw', '-o', '-', plist], { env, quiet: true })).trim();
  const inside = (...args) => command('git', ['-C', directory, ...args], { env, quiet: true });
  if (resolve(directory) !== process.cwd()) {
    if (await inside('branch', '--show-current') !== 'main' || await inside('status', '--porcelain', '--untracked-files=no')) throw new Error(`${directory} is not a clean checkout of main; the listener was left as it is.`);
    const before = await inside('rev-parse', 'HEAD');
    await inside('fetch', 'origin', 'main');
    await inside('merge', '--ff-only', sha);
    if (before !== sha && await inside('diff', '--name-only', before, sha, '--', 'package-lock.json')) await command('npm', ['ci', '--no-audit', '--no-fund'], { env, cwd: directory });
  }
  const service = `gui/${userInfo().uid}/${LISTENER}`;
  await command('launchctl', ['kickstart', '-k', service], { env });
  let running = false;
  for (let attempt = 0; attempt < 10 && !running; attempt++) {
    await new Promise(done => setTimeout(done, 2000));
    running = /state = running/.test(await command('launchctl', ['print', service], { env, quiet: true }));
  }
  if (!running) throw new Error(`${LISTENER} did not report "state = running" after the restart.`);
  await record('incident-listener');
  setResult('incident-listener', `released (restarted in ${directory})`);
}

let current = 'start';
const attempt = async (target, name, operation) => {
  current = target; step(name);
  await operation();
};
try {
  step(`Target: PRODUCTION, Convex ${DEPLOYMENT}; release ${sha}`);
  for (const target of TARGETS) if (want(target)) console.log(`RELEASE ${target}: ${rows.get(target).files.slice(0, 12).join(', ') || 'no recorded release, or behind main'}`);
  const remote = await remoteEnv(DEPLOYMENT, convexEnv);

  current = 'pre-flight';
  if (oldest) {
    step(`Pre-flight: compatibility ${short(oldest)}..${short(sha)}`);
    if (!existsSync(compatScript)) throw new Error(`${compatScript} is missing.`);
    await node([compatScript, '--base', oldest, '--head', sha]);
  } else console.log('Compatibility check skipped: no deployed commit is recorded (bootstrap with release:status --set).');
  step('Pre-flight: typecheck');
  await npm('typecheck');
  if (want('agent')) { await npm('agent-runner:install'); await npm('typecheck:agent-runner'); }
  if (want('mcp')) { await npm('mcp:install'); await npm('typecheck:mcp'); }
  if (want('processor') || want('exports')) await npm('typecheck:processor-edge');
  if (want('frontend')) { step('Pre-flight: build the frontend once'); await npm('build:cloudflare'); }

  deployStartedAt = Date.now();
  let processorRunning = null;
  if (want('processor')) await attempt('processor', 'Railway processor (GitHub autodeploy)', async () => { processorRunning = await railway('processor', await remoteEnv(DEPLOYMENT, convexEnv)); });
  // A raised contract means the new Convex code queues work only the new processor can claim. Whatever the reason
  // the processor is not at this commit (not promoted, not routed to Railway, left out with --only), Convex waits.
  // What Railway runs now, not what was recorded; a processor already past this commit counts as at it.
  const processorAt = processorRunning ?? (await readState())?.targets?.processor?.commit ?? baseCommit;
  if (want('convex') && !includesRelease(processorAt) && (!haveCommit(processorAt) || contractRaised(processorAt))) {
    current = 'convex';
    for (const target of ['convex', 'media', 'frontend', 'agent', 'mcp', 'exports', 'incident-listener']) if (want(target)) setResult(target, 'held: processor contract raised but the processor is not at this commit');
    throw new Error(`This range raises the media processor contract (${CONTRACT_FILE}) and the production processor is not at ${short(sha)}. Nothing else was deployed. Railway builds main by itself: wait until npm run release:status shows the processor at ${short(sha)} or later (a failed or crashing build shows there too), then run release:prod again (in CI: run the Release production workflow again).`);
  }
  // `convex deploy` returns only after the backend finished wait_for_schema: new indexes are backfilled and existing
  // documents validated against the schema before the functions are switched (convex/src/cli/lib/deploy2.ts,
  // waitForSchema then finishPush). No separate backfill wait is needed; verifyConvex then reads the live contract.
  if (want('convex')) await attempt('convex', `Convex ${DEPLOYMENT}`, async () => {
    const old = rows.get('convex').old;
    await node([...convexArgs, 'deploy', '--yes', '--message', sha, '--env-file', productionFile, '--typecheck', 'enable']);
    rollbacks.push({ target: 'convex', text: `Convex: manual (a redeploy of the previous commit; schema and data written since are not undone; never to a commit before Railway image slots while slots run images, docs/releases.md Rollback).\n    git worktree add --detach ../revline-rollback ${old ?? '<previous commit>'} && cd ../revline-rollback && npm ci\n    node ${CONVEX} deploy --yes --typecheck enable --env-file ${productionFile} --message "rollback to ${short(old)}"\n    cd - && git worktree remove ../revline-rollback` });
    await verifyConvex(DEPLOYMENT, convexEnv);
    await record('convex');
    setResult('convex', 'released');
  });
  if (want('media')) await attempt('media', 'Media Worker', () => worker('media'));
  if (want('frontend')) await attempt('frontend', 'Frontend Worker', () => worker('frontend'));
  if (want('agent')) await attempt('agent', 'Agent runner Worker', () => worker('agent', () => node(['scripts/sync-agent-runner-env.mjs', 'production'], { env: convexEnv })));
  if (want('mcp')) await attempt('mcp', 'MCP Worker', () => worker('mcp'));
  if (want('exports')) await attempt('exports', 'Railway export workers', async () => railway('exports', await remoteEnv(DEPLOYMENT, convexEnv)));

  await attempt('verification', 'Post-deploy verification', async () => {
    const problems = await verifyHealth(await remoteEnv(DEPLOYMENT, convexEnv));
    // Production always has some noise (a stranger with a bad secret, an old client). Only a kind of failure on a
    // function that did not show it before the first deploy of this run counts as caused by the release.
    const logs = await scanConvexLogs(DEPLOYMENT, convexEnv, { seconds: 30 });
    const before = new Set(logs.hits.filter(hit => hit.at !== undefined && hit.at < deployStartedAt).map(hit => hit.signature));
    const fresh = logs.hits.filter(hit => (hit.at === undefined || hit.at >= deployStartedAt) && !before.has(hit.signature));
    console.log(`Read ${logs.read} production log events; ${fresh.length} show a cross-version failure that was not there before this release (${logs.hits.length - fresh.length} others match a pattern but predate it or repeat an earlier one).`);
    for (const hit of fresh.slice(0, 10)) console.log(`  ${hit.text}`);
    if (fresh.length) problems.push(`${fresh.length} production log line(s) since the first deploy look like a cross-version break (${[...new Set(fresh.map(hit => hit.signature))].slice(0, 5).join(', ')})`);
    if (problems.length) { verified = false; throw new Error(`Post-deploy verification failed:\n  ${problems.join('\n  ')}`); }
  });
  if (want('incident-listener')) await attempt('incident-listener', 'Incident listener checkout', incidentListener);
} catch (error) {
  failure = { at: current, message: redact(error.message) };
  if (rows.has(current) && rows.get(current).result === 'pending') setResult(current, `FAILED: ${failure.message.split('\n')[0]}`);
  for (const target of TARGETS) if (rows.get(target).result === 'pending') setResult(target, `not released: stopped at ${current}`);
}

// Only after a complete release.
if (!failure && !railwayBehind && !flags['no-changelog'] && existsSync(changelogScript)) {
  step('Changelog');
  try {
    await node([changelogScript, 'build']);
    if (git('status', '--porcelain', '--', 'docs/changelog.md', 'docs/changelog.d')) {
      await command('git', ['add', '--', 'docs/changelog.md', 'docs/changelog.d'], { env });
      // [skip ci]: a docs-only commit must not start another main release.
      await command('git', ['commit', '-m', `Changelog: release ${short(sha)} [skip ci]`, '--', 'docs/changelog.md', 'docs/changelog.d'], { env });
      await command('git', ['push', 'origin', 'HEAD:main'], { env });
      console.log('Changelog assembled, committed and pushed to main.');
    } else console.log('No changelog fragments to assemble.');
  } catch (error) {
    // Leave main exactly at the released commit (the checkout was clean when this run started), so the next
    // release is not refused for being ahead of origin/main. The fragments stay for the next release.
    try { await command('git', ['reset', '--hard', sha], { env, quiet: true }); } catch { /* reported below */ }
    console.error(`Changelog not published (${redact(error.message)}). The release itself succeeded; the fragments in docs/changelog.d are kept and are assembled by the next release.`);
  }
}

if (failure) {
  console.error(`\nRELEASE FAILED at ${failure.at}: ${failure.message}`);
  if (rollbacks.length) {
    console.error(`\nRollback for what this run deployed (${flags['auto-rollback'] ? 'Workers that failed their check are rolled back now; ' : 'nothing is rolled back automatically; pass --auto-rollback for the Workers; '}Convex and Railway are manual):`);
    // Newest first: callers of a function go back before the function does.
    for (const item of [...rollbacks].reverse()) console.error(`  ${item.text}`);
    // Only what failed its check goes back: the one Worker whose own verification failed, or every Worker of this
    // run when the post-deploy verification failed. A later unrelated failure (listener, exports) leaves healthy
    // Workers serving, because Convex stays on the new version either way.
    const undo = !verified ? rollbacks : rollbacks.filter(item => item.target === failure.at);
    if (flags['auto-rollback'] && !undo.length) console.error('  --auto-rollback: the failure is not a failed Worker or post-deploy verification, so the Workers are left serving.');
    if (flags['auto-rollback']) for (const item of [...undo].reverse()) {
      if (!item.previous) continue;
      try {
        await node([WRANGLER, 'rollback', item.previous, '--config', item.config, '--message', `release ${short(sha)} failed verification`, '--yes']);
        await recordTarget(item.target, { commit: rows.get(item.target).old ?? null, at: new Date().toISOString(), version: item.previous, note: `rolled back from ${sha}` });
        setResult(item.target, `ROLLED BACK to ${item.previous.slice(0, 8)}`);
      } catch (error) { console.error(`  Rollback of ${item.target} failed: ${redact(error.message)}. Run the command above by hand.`); }
    }
  } else console.error('Nothing was deployed by this run, so there is nothing to roll back.');
}
// Published after a failure too: the targets that did release are recorded, so the next run continues from them.
// A publish that fails only makes the next plan larger (it compares with older commits), so it does not fail the run.
try { console.log(`\nShared release state, origin ${STATE_BRANCH}: ${await publishState(`release ${short(sha)}${failure ? ` (stopped at ${failure.at})` : ''}${ci ? ` by workflow run ${process.env.GITHUB_RUN_ID}` : ''}`)}.`); }
catch (error) { console.error(`${ci ? '::warning::' : ''}Shared release state not published (${redact(error.message)}). Publish it with npm run release:status -- --push.`); }
printTable();
if (railwayBehind && !failure) console.log('\nRailway does not run this commit on every lane yet; the changelog is assembled by the next release:prod after it does.');
console.log(failure ? `\nRelease ${short(sha)} FAILED. State: ${stateFile()}` : `\nRelease ${short(sha)} verified${railwayBehind ? ' except Railway (not at this commit yet)' : ''}. State: ${stateFile()} (npm run release:status).`);
process.exit(failure ? 1 : 0);
