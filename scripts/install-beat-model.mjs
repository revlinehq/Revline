import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const destination = process.env.BEAT_TRACK_MODEL_PATH || join(process.cwd(), '.data/beat-tracking-models/hub/checkpoints/beat_this-final0.ckpt');
const digest = '8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331';
const valid = bytes => createHash('sha256').update(bytes).digest('hex') === digest;
try {
  if (valid(await readFile(destination))) { console.log('Pinned Beat This model already installed.'); process.exit(0); }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
// The upstream host has intermittent 503s; retry before failing the build.
async function download() {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch('https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt', { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`Beat model download failed (${response.status}).`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 4) throw error;
      console.log(`${error.message} Retrying (${attempt}/3).`);
      await new Promise(resolve => setTimeout(resolve, 10_000 * attempt));
    }
  }
}
const bytes = await download();
if (!valid(bytes)) throw new Error('Beat model checksum does not match the pinned release.');
await mkdir(dirname(destination), { recursive: true });
const temporary = `${destination}.${process.pid}.tmp`;
try { await writeFile(temporary, bytes); await rename(temporary, destination); }
finally { await rm(temporary, { force: true }); }
console.log('Pinned Beat This model installed and checksum verified.');
