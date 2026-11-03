// Install this PC's repository-scoped runner as sonic's reboot-persistent service.
// Registration uses the existing gh login; no provider credentials are exported.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, access, rm, copyFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const home = homedir();
const directory = join(home, '.local/share/revline-actions-runner');
const unit = join(home, '.config/systemd/user/revline-actions-runner.service');
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...options });
if (process.getuid() === 0) throw new Error('Run as the normal PC user, never root.');
await mkdir(directory, { recursive: true, mode: 0o700 });
let configured = false;
try { await access(join(directory, '.runner')); configured = true; } catch {}
if (!configured) {
  const releases = JSON.parse(run('gh', ['api', 'repos/zuraHQ/revline-editor/actions/runners/downloads']));
  const release = releases.find(item => item.os === 'linux' && item.architecture === 'x64');
  if (!release?.sha256_checksum) throw new Error('GitHub did not return a checksummed Linux x64 runner.');
  console.log(`Installing ${release.filename}.`);
  const response = await fetch(release.download_url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`Runner download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== release.sha256_checksum) throw new Error('Runner checksum differs from GitHub metadata.');
  const archive = join(directory, release.filename);
  await writeFile(archive, bytes, { mode: 0o600 });
  run('tar', ['xzf', archive, '-C', directory]);
  await rm(archive);
  const registration = JSON.parse(run('gh', ['api', '-X', 'POST', 'repos/zuraHQ/revline-editor/actions/runners/registration-token']));
  run('./config.sh', ['--unattended', '--url', 'https://github.com/zuraHQ/revline-editor', '--token', registration.token, '--name', 'revline-deploy-pc', '--labels', 'revline-deploy-pc', '--work', '_work'], { cwd: directory });
}
const path = [dirname(process.execPath), join(home, '.fly/bin'), join(home, '.local/bin'), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
// svc.sh normally copies this entry point while installing a system service.
// Our user service needs the same entry point and a reboot-stable CLI path.
await copyFile(join(directory, 'bin/runsvc.sh'), join(directory, 'runsvc.sh'));
await chmod(join(directory, 'runsvc.sh'), 0o755);
await writeFile(join(directory, '.path'), path + '\n');
await mkdir(dirname(unit), { recursive: true });
await writeFile(unit, `[Unit]\nDescription=Revline GitHub Actions deployment runner\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${directory}\nExecStart=${directory}/runsvc.sh\nEnvironment="PATH=${path}"\nRestart=always\nRestartSec=5\nKillSignal=SIGTERM\nKillMode=process\nTimeoutStopSec=6h\n\n[Install]\nWantedBy=default.target\n`);
run('systemctl', ['--user', 'daemon-reload']);
run('systemctl', ['--user', 'enable', '--now', 'revline-actions-runner.service']);
const linger = run('loginctl', ['show-user', String(process.getuid()), '-p', 'Linger']).trim();
if (linger !== 'Linger=yes') throw new Error('Runner installed, but reboot persistence requires: loginctl enable-linger');
console.log(`Runner service enabled as ${process.env.USER}; lingering enabled. Logs: journalctl --user -u revline-actions-runner -f`);
