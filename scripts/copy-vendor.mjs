import { copyFileSync, mkdirSync, cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { patchHyperframesPlaybackRuntime } from './hyperframes-playback-compat.mjs';
import { SCENE_RUNTIME_BUNDLES } from '../lib/editor/scene-modules.ts';
mkdirSync('public/vendor', { recursive: true });
copyFileSync('node_modules/gsap/dist/gsap.min.js', 'public/vendor/gsap.min.js');
const hyperframesVersion=JSON.parse(readFileSync('node_modules/@hyperframes/core/package.json','utf8')).version;
writeFileSync('public/vendor/hyperframe.runtime.iife.js',patchHyperframesPlaybackRuntime(readFileSync('node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js','utf8'),hyperframesVersion));
if(existsSync('node_modules/@mediapipe/tasks-vision/wasm'))cpSync('node_modules/@mediapipe/tasks-vision/wasm','public/vendor/mediapipe',{recursive:true});
copyFileSync('node_modules/remotion/LICENSE.md', 'public/vendor/remotion-LICENSE.md');
await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], outfile: 'public/vendor/visual-effects.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineVisualEffects', legalComments: 'none' });

// Lucide's icons for scenes as {name: svg children}, sent to a scene frame only when its code calls icon('name').
{
  const dir='node_modules/lucide-react/dist/esm/icons',icons={};
  const attrs=props=>Object.entries(props).filter(([key])=>key!=='key').map(([key,value])=>`${key}="${String(value).replace(/"/g,'&quot;')}"`).join(' ');
  for(const file of readdirSync(dir).filter(name=>name.endsWith('.js'))){
    const match=/const __iconNode = (\[[\s\S]*?\]);\n/.exec(readFileSync(join(dir,file),'utf8'));
    if(match)icons[file.slice(0,-3)]=new Function(`return ${match[1]}`)().map(([tag,props])=>`<${tag} ${attrs(props)}/>`).join('');
  }
  writeFileSync('public/vendor/lucide-icons.json',JSON.stringify(icons));
  copyFileSync('node_modules/lucide-react/LICENSE','public/vendor/lucide-LICENSE');
}
await build({ entryPoints: ['lib/editor/remotion-runtime.ts'], outfile: 'public/vendor/remotion-runtime.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineRemotion', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });

// Build every advertised scene runtime from the shared import registry.
for (const [name, bundle] of Object.entries(SCENE_RUNTIME_BUNDLES)) {
  await build({ entryPoints: [bundle.entry], outfile: join('public/vendor', bundle.file), bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: bundle.global, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked',
    plugins: name !== 'three' ? [] : [{ name: 'scene-shared-react', setup(build) {
      build.onResolve({ filter: /^(react|react\/jsx-runtime)$/ }, args => ({ path: args.path, namespace: 'shared-react' }));
      build.onLoad({ filter: /.*/, namespace: 'shared-react' }, args => ({ contents: `module.exports = window[${JSON.stringify(SCENE_RUNTIME_BUNDLES.react.global)}].modules[${JSON.stringify(args.path)}];` }));
      build.onResolve({ filter: /^\.\/scene-react-runtime$/ }, () => ({ path: 'bridge', namespace: 'shared-scene' }));
      build.onLoad({ filter: /.*/, namespace: 'shared-scene' }, () => ({ contents: `module.exports = window[${JSON.stringify(SCENE_RUNTIME_BUNDLES.react.global)}].rendererBridge;` }));
    } }],
  });
}
