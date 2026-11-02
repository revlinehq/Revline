import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { configFile, configSchema, root, run, state } from './shared';

if (process.platform !== 'darwin') throw new Error('The incident LaunchAgent requires macOS');
await mkdir(state, { recursive: true, mode: 0o700 });
await chmod(state, 0o700);
// launchd cannot reliably read gh's interactive login keychain. Keep the existing credential private.
const githubToken = (await run('gh', ['auth', 'token', '--hostname', 'github.com'])).stdout.trim();
if (!githubToken) throw new Error('Sign in to GitHub CLI before installing the incident listener');
await writeFile(join(state, 'github-token'), githubToken, { mode: 0o600 });
await chmod(join(state, 'github-token'), 0o600);
const dev = parseEnv(await readFile(join(root, '.env.local'), 'utf8'));
if (dev.CONVEX_DEPLOYMENT !== 'dev:majestic-alpaca-541' || dev.NEXT_PUBLIC_CONVEX_URL !== 'https://majestic-alpaca-541.convex.cloud') throw new Error('Expected the existing isolated development environment');
const existing = await readFile(configFile, 'utf8').then(text => configSchema.parse(JSON.parse(text))).catch(() => null);
const randomSecret = async () => (await run('openssl', ['rand', '-hex', '32'])).stdout.trim();
const settings = existing ?? { repoRoot: root, codex: (await run('which', ['codex'])).stdout.trim(), endpoints: [
  { deployment: 'dev', url: 'https://majestic-alpaca-541.convex.cloud', secret: await randomSecret() },
  { deployment: 'prod', url: 'https://different-gnu-398.convex.cloud', secret: await randomSecret() },
] };
await writeFile(configFile, JSON.stringify({ ...settings, repoRoot: root }, null, 2), { mode: 0o600 });
await chmod(configFile, 0o600);
const endpoint = settings.endpoints.find(item => item.deployment === 'dev');
if (!endpoint) throw new Error('Missing dev listener credential');
console.info('Target: development Convex majestic-alpaca-541. Setting only its listener secret.');
await run(process.execPath, [join(root, 'node_modules/convex/bin/main.js'), 'env', 'set', 'INCIDENT_LISTENER_SECRET', endpoint.secret, '--env-file', join(root, '.env.local')], { cwd: root }).catch(() => { throw new Error('Could not set the development listener secret'); });
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const plist = join(homedir(), 'Library/LaunchAgents/com.revline.incidents.plist');
await mkdir(dirname(plist), { recursive: true });
await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.revline.incidents</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>--import</string><string>tsx</string><string>${escape(join(root, 'scripts/incident-listener/index.ts'))}</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(`${dirname(process.execPath)}:${homedir()}/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${escape(join(state, 'listener.log'))}</string>
<key>StandardErrorPath</key><string>${escape(join(state, 'listener-error.log'))}</string>
</dict></plist>\n`, { mode: 0o600 });
const domain = `gui/${process.getuid?.()}`;
await run('launchctl', ['bootout', `${domain}/com.revline.incidents`]).catch(() => {});
await run('launchctl', ['bootstrap', domain, plist]).catch(async () => {
  // launchd can return before a prior job finishes unloading. Retry this transition once.
  await new Promise(resolve => setTimeout(resolve, 1500));
  await run('launchctl', ['bootstrap', domain, plist]);
});
console.info(`Installed ${plist}. Logs: ${state}`);
console.info('Production is not changed. After merging and deploying the production functions, run exactly:');
const command = `npx convex env set INCIDENT_LISTENER_SECRET "$(node -p 'JSON.parse(require("fs").readFileSync(process.env.HOME + "/.revline-incidents/config.json", "utf8")).endpoints.find(e => e.deployment === "prod").secret')" --prod`;
await writeFile(join(state, 'enable-production.sh'), `${command}\n`, { mode: 0o600 });
console.info(command);
