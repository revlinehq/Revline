import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const destination = process.env.BEAT_TRACK_MODEL_PATH || join(process.cwd(), '.data/beat-tracking-models/hub/checkpoints/beat_this-final0.ckpt');
const digest = '8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331';
const valid = bytes => createHash('sha256').update(bytes).digest('hex') === digest;
// Two attempts per source: the fallback source replaces the old long retry loop on one host.
// Every source must serve the exact pinned bytes; the checksum is the trust, not the host.
// BEAT_MODEL_URL puts a mirror first; the Hugging Face copy is pinned to one repo commit.
const sources = [
  process.env.BEAT_MODEL_URL,
  'https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt',
  'https://huggingface.co/rtikw/localmusic-assets/resolve/a44f51ed621bc9895c15f8b46194cf16d7b22b66/analysis/beat_this-final0.ckpt',
].filter(Boolean);
// --optional: an image build continues without the model; the worker installs it on its first beat task.
const optional = process.argv.includes('--optional');
// --verify: never downloads; a missing model passes, a corrupt one fails.
const verify = process.argv.includes('--verify');

try {
  if (valid(await readFile(destination))) { console.log('Pinned Beat This model already installed.'); process.exit(0); }
  if (verify) throw new Error(`Installed Beat This model at ${destination} does not match the pinned checksum.`);
  console.log('Installed Beat This model does not match the pinned checksum; replacing it.');
  await rm(destination, { force: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (verify) { console.warn('Beat model is not installed; beat tasks will download it on first use.'); process.exit(0); }

const host = url => { try { return new URL(url).host; } catch { return url; } };
async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`Beat model download failed (${response.status}).`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!valid(bytes)) throw Object.assign(new Error('Beat model checksum does not match the pinned release.'), { final: true });
      return bytes;
    } catch (error) {
      if (error.final || attempt === 2) throw error;
      console.log(`${error.message} Retrying ${host(url)}.`);
      await new Promise(resolve => setTimeout(resolve, 10_000));
    }
  }
}

let bytes;
for (const url of sources) {
  try { bytes = await download(url); break; }
  catch (error) { console.log(`Beat model source ${host(url)} failed: ${error.message}`); }
}
if (!bytes) {
  if (!optional) throw new Error('Beat model download failed from every source.');
  console.warn('Beat model is not installed: every source failed. Beat tasks will download it on first use.');
  process.exit(0);
}
await mkdir(dirname(destination), { recursive: true });
const temporary = `${destination}.${process.pid}.tmp`;
try { await writeFile(temporary, bytes); await rename(temporary, destination); }
finally { await rm(temporary, { force: true }); }
console.log('Pinned Beat This model installed and checksum verified.');
