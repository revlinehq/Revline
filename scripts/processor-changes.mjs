// Decides whether a commit range changes what the production media processor
// runs: every repository file its entry points import, plus the runtime files
// it reads, spawns or bakes into the image.
// Usage: node scripts/processor-changes.mjs <base-commit>
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { PROCESSOR_SCRIPTS } from './processor-runtime.mjs';

export const ENTRIES = ['infra/media-worker/consumer.ts', 'infra/media-worker/edge/cloudflare.ts',
  // Browser runtimes copy-vendor.mjs bundles into public/vendor for exports.
  'lib/editor/remotion-text-runtime.tsx', 'lib/editor/remotion-transitions-runtime.ts', 'lib/editor/remotion-runtime.ts', 'lib/editor/visual-effects-runtime.ts', 'lib/editor/scene-runtime.ts', 'lib/editor/scene-react-runtime.tsx', 'lib/editor/scene-three-runtime.tsx'];
// Read, spawned or copied into the image without a static import.
export const RUNTIME_PREFIXES = [
  'infra/media-worker/', 'models/', 'public/vendor/', 'public/fonts/',
  ...PROCESSOR_SCRIPTS.map(name => `scripts/${name}`), 'scripts/processor-runtime.mjs', 'lib/render-resources.mjs',
  'package.json', 'package-lock.json', 'tsconfig.json',
  'lib/export-chunk-resources.mjs', 'lib/worker-capacity.mjs', 'lib/railway-workers.mjs', 'scripts/railway-workers.mjs', 'scripts/release-railway.mjs',
];

function report(changed, reason, files = []) {
  console.log(`Media processor ${changed ? 'changed' : 'unchanged'}: ${reason}`);
  for (const file of files) console.log(`  ${file}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  let known = false;
  try { known = !!base && !!git('cat-file', '-t', `${base}^{commit}`); } catch { known = false; }
  if (!known) report(true, `no deployed processor commit to compare with (${base || 'none'}); rebuilding to be safe.`);
  else {
    const result = await build({
      entryPoints: ENTRIES, bundle: true, write: false, metafile: true, outdir: 'out',
      platform: 'node', format: 'esm', packages: 'external', external: ['cloudflare:*'],
      loader: { '.node': 'empty' }, logLevel: 'silent',
    });
    const imported = new Set(Object.keys(result.metafile.inputs).filter(file => !file.startsWith('node_modules/')));
    const diff = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
    const hits = diff.filter(file => imported.has(file) || RUNTIME_PREFIXES.some(prefix => file === prefix || file.startsWith(prefix)));
    report(hits.length > 0, hits.length ? `${hits.length} processor file(s) differ from ${base.slice(0, 7)}.` : `no processor file differs from ${base.slice(0, 7)} (${diff.length} other file(s) changed).`, hits);
  }
}
