import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { configFile, endpointSchema, root, run, state } from './shared';
import { authorizeT3, callT3, withT3 } from './mcp';

if (process.platform !== 'linux' && process.platform !== 'darwin') throw new Error('The incident listener requires Linux or macOS');
await mkdir(state, { recursive: true, mode: 0o700 });
await chmod(state, 0o700);
const dev = parseEnv(await readFile(join(root, '.env.local'), 'utf8'));
if (dev.CONVEX_DEPLOYMENT !== 'dev:majestic-alpaca-541' || dev.NEXT_PUBLIC_CONVEX_URL !== 'https://majestic-alpaca-541.convex.cloud') throw new Error('Expected the existing isolated development environment');
const t3 = join(homedir(), '.t3/bin/t3');
await withT3(client => callT3(client, 't3_environment_read', {})).catch(async () => { await authorizeT3(t3); });
const common = (await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root })).stdout.trim();
const projectId = await withT3(async client => {
  let cursor: number | null = 0;
  while (cursor !== null) {
    const page = z.object({ projects: z.array(z.object({ id: z.string(), workspaceRoot: z.string() })), nextCursor: z.number().nullable() }).parse(await callT3(client, 't3_project_list', { cursor, limit: 100 }));
    for (const project of page.projects) {
      const git = await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: project.workspaceRoot }).catch(() => null);
      if (git?.stdout.trim() === common) return project.id;
    }
    cursor = page.nextCursor;
  }
  throw new Error('Add this Revline repository as a project in this PC\'s T3 Code before installing');
});
// Background services must not depend on an interactive GitHub credential store.
const githubToken = (await run('gh', ['auth', 'token', '--hostname', 'github.com'])).stdout.trim();
if (!githubToken) throw new Error('Sign in to GitHub CLI before installing the incident listener');
await writeFile(join(state, 'github-token'), githubToken, { mode: 0o600 });
await chmod(join(state, 'github-token'), 0o600);
const existing = await readFile(configFile, 'utf8').then(text => z.object({ endpoints: z.array(endpointSchema).min(1).max(2) }).parse(JSON.parse(text))).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null; });
const endpoints = existing?.endpoints ?? [{ deployment: 'dev' as const, url: 'https://majestic-alpaca-541.convex.cloud' as const, secret: randomBytes(32).toString('hex') }];
await writeFile(configFile, JSON.stringify({ repoRoot: root, t3ProjectId: projectId, endpoints }, null, 2), { mode: 0o600 });
await chmod(configFile, 0o600);
const endpoint = endpoints.find(item => item.deployment === 'dev');
if (!endpoint) throw new Error('Missing dev listener credential');
console.info('Target: development Convex majestic-alpaca-541. Setting only its listener secret.');
await run(process.execPath, [join(root, 'node_modules/convex/bin/main.js'), 'env', 'set', 'INCIDENT_LISTENER_SECRET', endpoint.secret, '--env-file', join(root, '.env.local')], { cwd: root }).catch(() => { throw new Error('Could not set the development listener secret'); });
if (process.platform === 'linux') {
  const unit = join(homedir(), '.config/systemd/user/revline-incidents.service');
  const quote = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
  await mkdir(dirname(unit), { recursive: true });
  await writeFile(unit, `[Unit]
Description=Revline incident listener (T3 Code MCP)
After=network-online.target t3code.service
Wants=t3code.service

[Service]
Type=simple
WorkingDirectory=${root.replaceAll('%', '%%')}
ExecStart=${quote(process.execPath)} --import tsx ${quote(join(root, 'scripts/incident-listener/index.ts'))}
Environment=${quote(`PATH=${dirname(process.execPath)}:${homedir()}/.t3/bin:${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`)}
UMask=0077
Restart=on-failure
RestartSec=10
# T3 owns the Sols. Detached claim/PR monitors survive listener restarts too.
KillMode=process
StandardOutput=append:${join(state, 'listener.log').replaceAll('%', '%%')}
StandardError=append:${join(state, 'listener-error.log').replaceAll('%', '%%')}

[Install]
WantedBy=default.target
`, { mode: 0o600 });
  await run('systemctl', ['--user', 'daemon-reload']);
  await run('systemctl', ['--user', 'disable', '--now', 'revline-incidents.service']);
  console.info(`Installed ${unit}, stopped and disabled. Enable after review: systemctl --user enable --now revline-incidents.service`);
} else {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const plist = join(homedir(), 'Library/LaunchAgents/com.revline.incidents.plist');
  await mkdir(dirname(plist), { recursive: true });
  await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.revline.incidents</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>--import</string><string>tsx</string><string>${escape(join(root, 'scripts/incident-listener/index.ts'))}</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(`${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${escape(join(state, 'listener.log'))}</string>
<key>StandardErrorPath</key><string>${escape(join(state, 'listener-error.log'))}</string>
</dict></plist>\n`, { mode: 0o600 });
  console.info(`Installed ${plist} without loading it. Linux is the primary host; leave the Mac LaunchAgent unloaded.`);
}
console.info(`Private config, MCP sign-in (30 days), jobs and logs: ${state}. No production configuration changed.`);
