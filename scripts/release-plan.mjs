// Follow local imports (including type-only imports) so shared code cannot silently
// miss a backend or Worker release. Runtime files without imports are explicit below.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { ENTRIES, RUNTIME_PREFIXES } from './processor-changes.mjs';

export function releasePlan(base) {
  const root = process.cwd();
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const tracked = git('ls-files').split('\n');
  const options = ts.readConfigFile('tsconfig.json', ts.sys.readFile).config;
  const config = ts.parseJsonConfigFileContent(options, ts.sys, root).options;
  function imports(entries) {
    const found = new Set();
    function visit(name) {
      // Generated API declarations mention every Convex module for type safety;
      // their runtime .js counterpart imports none of those modules.
      if (name.endsWith('.d.ts')) {
        const runtime = name.replace(/\.d\.ts$/, '.js');
        if (tracked.includes(runtime)) visit(runtime);
        return;
      }
      if (found.has(name) || !tracked.includes(name)) return;
      found.add(name);
      if (!/\.[cm]?[jt]sx?$/.test(name)) return;
      for (const imported of ts.preProcessFile(readFileSync(name, 'utf8'), true, true).importedFiles) {
        const file = ts.resolveModuleName(imported.fileName, resolve(name), config, ts.sys).resolvedModule?.resolvedFileName;
        if (file && !file.includes('/node_modules/')) visit(relative(root, file));
      }
    }
    for (const entry of entries) visit(entry);
    return found;
  }
  if (base) git('cat-file', '-e', `${base}^{commit}`);
  const files = (base ? git('diff', '--name-only', base, 'HEAD').split('\n') : tracked).filter(file => file && !file.startsWith('mobile/'));
  const shared = ['package.json', 'package-lock.json', 'tsconfig.json'];
  const matches = (file, paths) => paths.some(path => file === path || (path.endsWith('/') && file.startsWith(path)));
  const services = {
    processor: { graph: imports(ENTRIES), paths: [...RUNTIME_PREFIXES, 'lib/media-analysis/processor-version.ts'] },
    convex: { graph: imports(tracked.filter(file => file.startsWith('convex/') && file.endsWith('.ts'))), paths: ['convex/', 'convex.json'] },
    media: { graph: imports(['cloudflare/media/worker.ts']), paths: ['cloudflare/media/'] },
    agent: { graph: imports(['cloudflare/agent-runner/worker.ts']), paths: ['cloudflare/agent-runner/', 'lib/ai/', 'convex/lib/editorTurn.ts', 'scripts/sync-agent-runner-env.mjs'] },
    exports: { graph: imports(['infra/media-worker/consumer.ts', ...ENTRIES.slice(2)]), paths: ['infra/media-worker/', 'public/vendor/', 'public/fonts/', 'scripts/render-', 'scripts/composition-review-worker.mjs', 'scripts/copy-vendor.mjs', 'scripts/hyperframes-playback-compat.mjs', 'scripts/deploy-fly-exports.mjs'] },
    frontend: { graph: new Set(), paths: ['app/', 'components/', 'lib/', 'public/', 'landing/', 'next.config.ts', 'vite.config.ts', 'wrangler.jsonc', 'postcss.config.mjs', 'proxy.ts', 'scripts/cloudflare-frontend.mjs', 'scripts/copy-vendor.mjs'] },
  };
  const plan = {};
  for (const [name, service] of Object.entries(services)) {
    const hits = files.filter(file => shared.includes(file) || service.graph.has(file) || matches(file, service.paths) || (name === 'exports' && file.startsWith('scripts/render-')));
    plan[name] = { changed: !base || hits.length > 0, files: hits };
  }
  // Raising the processor contract always includes a backend release, even if the
  // dependency resolver changes or the import moves in a future refactor.
  if (plan.processor.changed) plan.convex.changed = true;
  return { base: base || null, files, services: plan };
}
