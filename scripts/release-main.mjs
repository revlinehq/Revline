// One ordered release on the PC. Dispatch is always read-only; only a push to
// protected main can reach the mutating commands below.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, symlink, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { command, mask, redact, logTail } from './release-command.mjs';
import { convexArgs, remoteEnv, verifyConvex, verifyWorker, verifyFrontend } from './release-verify.mjs';
import { releaseRailway, verifyRailway } from './release-railway.mjs';
import { REPOSITORY as repo, isRevlineRepository } from '../lib/repository.mjs';

const dry = process.argv.includes('--dry-run');
const state = join(homedir(), '.local/state/revline-deploy');
const primary = join(homedir(), 'Developer/revline-main');
const productionFile = join(primary, '.env.production.local');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
let step = 'Initialize release';
const sha = git('rev-parse', 'HEAD');
const env = { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true', PATH: [dirname(process.execPath), join(homedir(), '.local/bin'), '/usr/local/bin', '/usr/bin', '/bin'].join(':') };
// Never inherit a deployment selection or provider token from another session.
for (const name of Object.keys(env)) if (name.startsWith('FLY_')) delete env[name];
for (const name of ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT', 'NEXT_PUBLIC_CONVEX_URL', 'CLOUDFLARE_API_TOKEN', 'RAILWAY_API_TOKEN', 'REVLINE_FRONTEND_ENV_FILE', 'REVLINE_ENV_FILE']) delete env[name];
const targets = [
  { name: 'production', deployment: 'different-gnu-398', file: productionFile },
  { name: 'dev', deployment: 'majestic-alpaca-541', file: join(primary, '.env.local') },
];
const run = async (name, cmd, args, options) => {
  step = name;
  console.log(`\n::group::${name}${dry ? ' [dry run]' : ''}`);
  try { return await command(cmd, args, { env, ...options }); }
  finally { console.log('::endgroup::'); }
};
const node = (name, args, options) => run(name, process.execPath, args, options);
const npm = (name, args, options) => run(name, 'npm', args, options);
const check = async (name, operation) => { step = name; await operation(); };

async function restartDevelopment() {
  const gitMain = (...args) => command('git', args, { env, cwd: primary, quiet: true });
  if (await gitMain('branch', '--show-current') !== 'main' || await gitMain('status', '--porcelain', '--untracked-files=no')) throw new Error('Primary checkout must be on main without tracked edits; no worktree was reset.');
  await gitMain('-c', 'url.https://github.com/.insteadOf=git@github.com:', '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'fetch', 'origin', 'main');
  await gitMain('merge-base', '--is-ancestor', 'HEAD', sha);
  await command('systemctl', ['--user', 'stop', 'revline-dev.service'], { env });
  // Adopt only the primary checkout's manually started npm run dev, if present.
  // Other worktrees and their workers are never signalled.
  const { readdir, readlink } = await import('node:fs/promises');
  for (const pid of (await readdir('/proc')).filter(value => /^\d+$/.test(value))) {
    try {
      if (await readlink(`/proc/${pid}/cwd`) !== primary) continue;
      const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
      if (args[1] === 'scripts/dev.mjs') process.kill(Number(pid), 'SIGTERM');
    } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
  }
  await gitMain('merge', '--ff-only', sha);
  await command('npm', ['ci'], { env, cwd: primary });
  const since = new Date().toISOString();
  await command('systemctl', ['--user', 'enable', '--now', 'revline-dev.service'], { env });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const logs = await command('journalctl', ['--user', '-u', 'revline-dev.service', '--since', since, '--no-pager', '-o', 'cat'], { env, quiet: true });
    if (/\[web\].*Ready/i.test(logs) && /\[worker\].*Revline media worker ready/.test(logs)) {
      const response = await fetch('http://localhost:3001', { signal: AbortSignal.timeout(10000) });
      if (response.ok) { console.log('Verified main on port 3001: [web] and [worker] ready.'); return; }
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('Main development service did not report both [web] and [worker] readiness.');
}

try {
  if (!dry && (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main' || !isRevlineRepository(env.GITHUB_REPOSITORY) || env.GITHUB_SHA !== sha)) throw new Error('Live releases require the main push workflow at its exact commit. Use --dry-run for dispatch.');
  step = 'Check required PC production environment file';
  let production;
  try { production = parseEnv(await readFile(productionFile, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing required file: ${productionFile}. The user must place their production environment file on this PC once. The workflow never creates it or copies secrets.`);
    throw error;
  }
  mask(production);
  if (production.CONVEX_DEPLOYMENT !== 'prod:different-gnu-398' || production.NEXT_PUBLIC_CONVEX_URL !== 'https://different-gnu-398.convex.cloud') throw new Error(`${productionFile} must target prod:different-gnu-398 and https://different-gnu-398.convex.cloud.`);
  step = 'Check for a manual production release';
  const manualLock = join(primary, '.data/production-releases/release.lock');
  try { await access(manualLock); throw new Error(`A manual production release holds ${manualLock}. Wait for it to finish before running this workflow.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // The frontend's build helper falls back to committed live public settings only
  // in a clean checkout. Never expose the primary processor/Convex env file here.
  try { await access('.env.production.local'); throw new Error('Runner checkout contains .env.production.local. Frontend builds require a clean checkout; do not copy or link the PC production file here.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  step = 'Check required host CLIs';
  for (const [cli, args] of [['node', ['--version']], ['npm', ['--version']], ['npx', ['--version']], ['docker', ['--version']], ['gh', ['--version']], ['git', ['--version']]]) {
    try { await command(cli, args, { env, quiet: true }); }
    catch { throw new Error(`Required CLI '${cli}' is unavailable or cannot run. Explicit PATH: ${env.PATH}`); }
  }
  await mkdir(state, { recursive: true, mode: 0o700 });
  let base;
  if (dry && env.RELEASE_BASE) base = git('rev-parse', `${env.RELEASE_BASE}^{commit}`);
  else {
    try { base = JSON.parse(await readFile(join(state, 'released.json'), 'utf8')).sha; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (base) {
    if (base === sha || (!dry && spawnSync('git', ['merge-base', '--is-ancestor', sha, base], { stdio: 'ignore' }).status === 0)) {
      console.log('This commit has already been released.'); process.exit(0);
    }
    git('merge-base', '--is-ancestor', base, sha);
  }
  const dev = parseEnv(await readFile(targets[1].file, 'utf8'));
  mask(dev);
  if (dev.CONVEX_DEPLOYMENT !== 'dev:majestic-alpaca-541' || dev.NEXT_PUBLIC_CONVEX_URL !== 'https://majestic-alpaca-541.convex.cloud') throw new Error('PC development env targets the wrong backend.');
  await symlink(targets[1].file, '.env.local').catch(error => { if (error.code !== 'EEXIST') throw error; });
  await npm('Install dependencies', ['ci']);
  await npm('Install agent runner dependencies', ['run', 'agent-runner:install']);
  for (const cli of ['convex', 'wrangler']) {
    step = `Check installed ${cli} CLI`;
    try { await command('npx', ['--no-install', cli, '--version'], { env, quiet: true }); }
    catch { throw new Error(`Required project CLI '${cli}' cannot run after npm ci. Restore the project's locked dependencies before deploying.`); }
  }
  const { releasePlan } = await import('./release-plan.mjs');
  step = 'Detect changed services';
  const plan = releasePlan(base);
  console.log(`Comparing ${base || 'no successful release (full bootstrap)'} -> ${sha}. mobile/ excluded.`);
  for (const [name, service] of Object.entries(plan.services)) console.log(`${service.changed ? 'RELEASE' : 'SKIP'} ${name}: ${service.files.slice(0, 25).join(', ')}${service.files.length > 25 ? ', …' : ''}`);
  const changed = name => plan.services[name].changed;
  const planText = `Release ${sha} (${dry ? 'DRY RUN — no deployments or restart' : 'main push'})\nBase: ${base || 'full bootstrap'}\nOrder: selected processor host → Convex → media / agent / exports → frontend → PC dev restart\n${Object.entries(plan.services).map(([name, service]) => `- ${name}: ${service.changed ? 'release' : 'skip'}`).join('\n')}`;
  console.log(planText);
  if (env.GITHUB_STEP_SUMMARY) await writeFile(env.GITHUB_STEP_SUMMARY, planText);
  for (const name of ['typecheck', 'typecheck:agent-runner', 'typecheck:processor-edge']) await npm(name, ['run', name]);
  await npm('Build Next.js', ['run', 'build']);
  // Resolve and mask each target independently. DEV local processing is retained.
  const workerSettings = new Map();
  for (const target of targets) workerSettings.set(target.deployment, await remoteEnv(target.deployment, env));
  for (const target of targets) {
    const values = workerSettings.get(target.deployment);
    const processor = values.MEDIA_PROCESSOR_BACKEND || (values.MEDIA_PROCESSOR_WAKE_URL ? 'cloudflare' : 'local');
    if (!['local', 'cloudflare', 'railway'].includes(processor) || !['local', 'railway'].includes(values.RENDER_PROVIDER || 'local')) throw new Error(`${target.name}: select a supported worker host before releasing.`);
  }
  const railwayRole = (target, kind) => workerSettings.get(target.deployment)[kind === 'processor' ? 'MEDIA_PROCESSOR_BACKEND' : 'RENDER_PROVIDER'] === 'railway';
  if (changed('processor')) for (const target of targets) {
    if (railwayRole(target, 'processor')) await check(`${target.name}: Railway processor image`, () => releaseRailway({ target, kind: 'processor', values: workerSettings.get(target.deployment), env, dry }));
    else if (workerSettings.get(target.deployment).MEDIA_PROCESSOR_BACKEND === 'cloudflare') throw new Error('Release the Cloudflare processor through its dedicated edge configuration.');
    else console.log(`${target.name}: local processing uses the updated development checkout.`);
  }
  if (changed('convex')) for (const target of targets) {
    console.log(`Target: ${target.name} Convex (${target.deployment}).${dry ? ' Dry run only.' : ''}`);
    if (dry && target.name === 'dev') console.log('Would run convex dev --once --env-file <PC dev env> --typecheck enable (no dev dry-run flag).');
    else await node(`${target.name}: Convex functions`, [...convexArgs, ...(target.name === 'production' ? ['deploy', '--yes', '--message', sha] : ['dev', '--once']), '--env-file', target.file, '--typecheck', 'enable', ...(dry ? ['--dry-run'] : [])]);
    if (!dry) await check(`${target.name}: verify Convex functions`, () => verifyConvex(target.deployment, env));
  }
  for (const target of targets) {
    const suffix = target.name === 'production' ? '.production' : '';
    if (changed('media')) {
      const config = `cf-workers/media/wrangler${suffix}.jsonc`;
      const output = await node(`${target.name}: media Worker`, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', config, ...(dry ? ['--dry-run'] : [])]);
      if (!dry) await check(`${target.name}: verify media Worker`, () => verifyWorker(config, output, env));
    }
    if (changed('agent')) {
      await node(`${target.name}: sync agent settings`, ['scripts/sync-agent-runner-env.mjs', target.name, ...(dry ? ['--dry-run'] : [])]);
      const config = `cf-workers/agent-runner/wrangler${suffix}.jsonc`;
      const output = dry
        ? await node(`${target.name}: agent runner Worker`, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', config, '--dry-run'])
        : await npm(`${target.name}: agent runner Worker`, ['run', target.name === 'production' ? 'deploy:agent-runner:production' : 'deploy:agent-runner']);
      if (!dry) await check(`${target.name}: verify agent Worker`, () => verifyWorker(config, output, env));
    }
    if (changed('exports')) {
      if (railwayRole(target, 'exports')) await check(`${target.name}: Railway exports`, async () => releaseRailway({ target, kind: 'exports', values: await remoteEnv(target.deployment, env), env, dry }));
      else console.log(`${target.name}: exports use the local processor.`);
    }
    if (!dry) for (const kind of ['processor', 'exports']) if (changed(kind)) {
      if (railwayRole(target, kind)) await check(`${target.name}: verify Railway ${kind}`, async () => verifyRailway({ deployment: target.deployment, kind, values: await remoteEnv(target.deployment, env) }));
    }
  }
  if (changed('frontend')) {
    const options = { env };
    if (dry) {
      await npm('Build production frontend', ['run', 'build:cloudflare'], options);
      await node('Production frontend upload (dry run)', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'dist/server/wrangler.json', '--dry-run']);
    } else {
      const output = await npm('Production frontend build and upload', ['run', 'deploy:frontend:ci'], options);
      await check('Verify frontend Worker', () => verifyWorker('dist/server/wrangler.json', output, env));
      await check('Verify live frontend build ID', verifyFrontend);
    }
  }
  if (dry) console.log(`Would fast-forward only ${primary} to ${sha} and restart revline-dev.service (npm run dev, port 3001), checking [web] and [worker].`);
  else {
    await check('Restart main development web and worker', restartDevelopment);
    await writeFile(join(state, 'released.json.tmp'), JSON.stringify({ sha, releasedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    await rename(join(state, 'released.json.tmp'), join(state, 'released.json'));
  }
  console.log(dry ? 'Dry run complete. No cloud resources deployed; no dev server restarted; release cursor unchanged.' : `Release ${sha} verified and recorded.`);
} catch (error) {
  const url = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`;
  const description = `${dry ? 'Dry run' : 'Main release'} failed at **${step}** for ${sha}.\n${redact(error.message)}\nLogs: ${url}\n\n\`\`\`text\n${logTail()}\n\`\`\``;
  console.error(description);
  // Failure alerts use the already-deployed outbox; dry runs are clearly labelled.
  if (env.GITHUB_RUN_ID) {
    try { await command('gh', ['api', `repos/${repo}/commits/${sha}/comments`, '--input', '-'], { env, input: JSON.stringify({ body: description }), quiet: true }); }
    catch { console.error('Commit comment failed; opening a deployment failure issue.');
      try { await command('gh', ['api', `repos/${repo}/issues`, '--input', '-'], { env, input: JSON.stringify({ title: `Deployment failed: ${step}`, body: description }), quiet: true }); }
      catch { console.error('GitHub notification failed; inspect this workflow log.'); }
    }
    try {
      await command(process.execPath, [join(primary, 'node_modules/convex/bin/main.js'), 'run', 'discordAlerts:enqueue', JSON.stringify({ source: 'sentry', eventId: `deploy-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`, title: dry ? 'Revline deployment dry run failed' : 'Revline deployment failed', description: `Step: ${step}\nCommit: ${sha}\n${url}` }), '--deployment', 'different-gnu-398'], { env, cwd: primary, quiet: true });
    } catch { console.error('Convex Discord notification failed; GitHub remains the alert channel.'); }
    if (env.RUNNER_TEMP) await writeFile(join(env.RUNNER_TEMP, `revline-release-reported-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`), step).catch(() => {});
  }
  process.exitCode = 1;
}
