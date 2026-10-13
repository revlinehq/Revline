import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const context = join(root, '.wrangler/media-processor-build');
await rm(context, { recursive: true, force: true });
await mkdir(context, { recursive: true });
const prohibited = part => part.startsWith('.env') || part.startsWith('.dev.vars') || ['.git', '.data', 'node_modules', '.next', '.next-build', '.wrangler'].includes(part) || /\.(key|pem|sqlite3?)$/.test(part);
const filter = path => {
  const parts = relative(root, path).split('/');
  return !parts.some(prohibited) && !parts.some(part => ['__tests__', '__fixtures__', 'fixtures'].includes(part)) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(parts.at(-1)) && !(parts[0] === 'public' && parts[1] === 'uploads');
};
for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'lib', 'convex', 'public', 'infra/media-worker']) {
  await mkdir(dirname(join(context, name)), { recursive: true });
  await cp(join(root, name), join(context, name), { recursive: true, dereference: false, filter });
}
for (const name of ['render-worker.mjs', 'detect-shots.py', 'detect-beats.py', 'install-beat-model.mjs', 'copy-vendor.mjs', 'beat-tracking-requirements.txt', 'scene-detection-requirements.txt', 'video-import-requirements.txt']) {
  await mkdir(join(context, 'scripts'), { recursive: true });
  await cp(join(root, 'scripts', name), join(context, 'scripts', name));
}
// Wrangler rewrites Dockerfiles before building, so use a context that is safe
// even if the Dockerfile-specific ignore file is not copied by its builder.
await writeFile(join(context, '.dockerignore'), '**/.env*\n**/.dev.vars*\n**/.git/**\n**/.data/**\npublic/uploads/**\n');
async function inspect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (prohibited(item.name)) throw new Error('Sensitive path appeared in the container build context.');
    if (item.isSymbolicLink()) throw new Error('Symlink appeared in the container build context.');
    if (item.isDirectory()) await inspect(join(directory, item.name));
  }
}
await inspect(context);
console.log('Prepared allow-list container context without credentials, local media or Git history.');
