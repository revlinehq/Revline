// One ordered release on the PC. Dispatch is always read-only; only a push to
// protected main can reach the mutating commands below.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { command, mask, redact, logTail } from './release-command.mjs';
import { convexArgs, remoteEnv, verifyConvex, verifyWorker, verifyFrontend, verifyFly } from './release-verify.mjs';

const dry = process.argv.includes('--dry-run');
const repo = 'zuraHQ/revline-editor';
const state = join(homedir(), '.local/state/revline-deploy');
const primary = join(homedir(), 'Developer/revline-main');
const productionFile = join(homedir(), '.config/revline-deploy/production.env');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
let step = 'Initialize release';
const sha = git('rev-parse', 'HEAD');
const env = { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' };
// Never inherit a deployment selection or provider token from another session.
for (const name of ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT', 'NEXT_PUBLIC_CONVEX_URL', 'CLOUDFLARE_API_TOKEN', 'FLY_API_TOKEN']) delete env[name];
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
  if (!dry && (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REPOSITORY !== repo || env.GITHUB_SHA !== sha)) throw new Error('Live releases require the main push workflow at its exact commit. Use --dry-run for dispatch.');
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
  const publicConfig = JSON.parse(await readFile('wrangler.jsonc', 'utf8')).vars;
  await mkdir(join(homedir(), '.config/revline-deploy'), { recursive: true, mode: 0o700 });
  // Public selectors only. Production secrets stay on their existing services.
  await writeFile(productionFile, Object.entries({ ...publicConfig, CONVEX_DEPLOYMENT: 'prod:different-gnu-398' }).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'), { mode: 0o600 });
  await symlink(targets[1].file, '.env.local').catch(error => { if (error.code !== 'EEXIST') throw error; });
  await npm('Install dependencies', ['ci']);
  await npm('Install agent runner dependencies', ['run', 'agent-runner:install']);
  const { releasePlan } = await import('./release-plan.mjs');
  step = 'Detect changed services';
  const plan = releasePlan(base);
  console.log(`Comparing ${base || 'no successful release (full bootstrap)'} -> ${sha}. mobile/ excluded.`);
  for (const [name, service] of Object.entries(plan.services)) console.log(`${service.changed ? 'RELEASE' : 'SKIP'} ${name}: ${service.files.slice(0, 25).join(', ')}${service.files.length > 25 ? ', …' : ''}`);
  const changed = name => plan.services[name].changed;
  const planText = `Release ${sha} (${dry ? 'DRY RUN — no deployments or restart' : 'main push'})\nBase: ${base || 'full bootstrap'}\nOrder: Fly processor → Convex → media / agent / exports → frontend → PC dev restart\n${Object.entries(plan.services).map(([name, service]) => `- ${name}: ${service.changed ? 'release' : 'skip'}`).join('\n')}`;
  console.log(planText);
  if (env.GITHUB_STEP_SUMMARY) await writeFile(env.GITHUB_STEP_SUMMARY, planText);
  for (const name of ['typecheck', 'typecheck:agent-runner', 'typecheck:processor-edge']) await npm(name, ['run', name]);
  await npm('Build Next.js', ['run', 'build']);
  // Resolve and mask each target's settings before any deploy command can log.
  for (const target of targets) await remoteEnv(target.deployment, env);
  if (changed('processor')) {
    if (!dry) {
      await run('Verify Fly CLI login', 'flyctl', ['auth', 'whoami']);
      await run('Restore pinned beat model', 'gh', ['release', 'download', 'beat-model-final0', '-R', repo, '-p', 'beat_this-final0.ckpt', '-D', '.data/beat-tracking-models/hub/checkpoints', '--clobber']);
      await node('Verify pinned beat model', ['scripts/install-beat-model.mjs']);
    }
    for (const target of targets) {
      const options = { env: { ...env, REVLINE_ENV_FILE: target.file } };
      console.log(`Target: ${target.name} ${target.deployment}; Fly image BEFORE Convex.`);
      await npm(`${target.name}: Fly processor image`, ['run', target.name === 'production' ? 'deploy:production' : 'deploy:fly-processor', '--', ...(target.name === 'production' ? ['--processor-only'] : ['--skip-convex']), '--stage-only', '--image-first', ...(dry ? ['--dry-run'] : [])], options);
    }
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
      const config = `cloudflare/media/wrangler${suffix}.jsonc`;
      const output = await node(`${target.name}: media Worker`, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', config, ...(dry ? ['--dry-run'] : [])]);
      if (!dry) await check(`${target.name}: verify media Worker`, () => verifyWorker(config, output, env));
    }
    if (changed('agent')) {
      await node(`${target.name}: sync agent settings`, ['scripts/sync-agent-runner-env.mjs', target.name, ...(dry ? ['--dry-run'] : [])]);
      const config = `cloudflare/agent-runner/wrangler${suffix}.jsonc`;
      const output = dry
        ? await node(`${target.name}: agent runner Worker`, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', config, '--dry-run'])
        : await npm(`${target.name}: agent runner Worker`, ['run', target.name === 'production' ? 'deploy:agent-runner:production' : 'deploy:agent-runner']);
      if (!dry) await check(`${target.name}: verify agent Worker`, () => verifyWorker(config, output, env));
    }
    if (changed('exports')) await npm(`${target.name}: Fly exports`, ['run', 'deploy:fly-exports', '--', ...(target.name === 'production' ? ['--prod'] : []), ...(dry ? ['--dry-run'] : [])], { env: { ...env, REVLINE_ENV_FILE: target.file } });
    if (!dry) for (const kind of ['processor', 'exports']) if (changed(kind)) await check(`${target.name}: verify Fly ${kind}`, () => verifyFly(target.deployment, kind, env));
  }
  if (changed('frontend')) {
    const options = { env: { ...env, REVLINE_FRONTEND_ENV_FILE: productionFile } };
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
  // A dry run cannot mutate production, including its notification outbox.
  if (env.GITHUB_RUN_ID) {
    try { await command('gh', ['api', `repos/${repo}/commits/${sha}/comments`, '--input', '-'], { env, input: JSON.stringify({ body: description }), quiet: true }); }
    catch { console.error('Commit comment failed; opening a deployment failure issue.');
      try { await command('gh', ['api', `repos/${repo}/issues`, '--input', '-'], { env, input: JSON.stringify({ title: `Deployment failed: ${step}`, body: description }), quiet: true }); }
      catch { console.error('GitHub notification failed; inspect this workflow log.'); }
    }
    if (!dry) try {
      await command(process.execPath, [join(primary, 'node_modules/convex/bin/main.js'), 'run', 'discordAlerts:enqueue', JSON.stringify({ source: 'sentry', eventId: `deploy-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`, title: 'Revline deployment failed', description: `Step: ${step}\nCommit: ${sha}\n${url}` }), '--deployment', 'different-gnu-398'], { env, cwd: primary, quiet: true });
    } catch { console.error('Convex Discord notification failed; GitHub remains the alert channel.'); }
    if (env.RUNNER_TEMP) await writeFile(join(env.RUNNER_TEMP, `revline-release-reported-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`), step).catch(() => {});
  }
  process.exitCode = 1;
}
