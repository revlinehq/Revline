// Installs the link importer (yt-dlp) for local development from the same
// requirements file the processor image uses, so both run the same version.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const venv = join(root, '.data', 'video-import');
const python = join(venv, 'bin', 'python');
const requirements = join(root, 'scripts', 'video-import-requirements.txt');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
const hasUv = (() => { try { execFileSync('uv', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

if (hasUv) {
  if (!existsSync(python)) run('uv', ['venv', venv]);
  run('uv', ['pip', 'install', '--python', python, '-r', requirements]);
} else {
  if (!existsSync(python)) run('python3', ['-m', 'venv', venv]);
  run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements]);
}
console.log(`Video-link importer: yt-dlp ${execFileSync(join(venv, 'bin', 'yt-dlp'), ['--version'], { encoding: 'utf8' }).trim()} in .data/video-import.`);
