import { copyFileSync, mkdirSync, cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { patchHyperframesPlaybackRuntime } from './hyperframes-playback-compat.mjs';
mkdirSync('public/vendor', { recursive: true });
copyFileSync('node_modules/gsap/dist/gsap.min.js', 'public/vendor/gsap.min.js');
const hyperframesVersion=JSON.parse(readFileSync('node_modules/@hyperframes/core/package.json','utf8')).version;
writeFileSync('public/vendor/hyperframe.runtime.iife.js',patchHyperframesPlaybackRuntime(readFileSync('node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js','utf8'),hyperframesVersion));
if(existsSync('node_modules/@mediapipe/tasks-vision/wasm'))cpSync('node_modules/@mediapipe/tasks-vision/wasm','public/vendor/mediapipe',{recursive:true});
await build({ entryPoints: ['lib/editor/remotion-text-runtime.tsx'], outfile: 'public/vendor/remotion-text.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineRemotionText', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });
copyFileSync('node_modules/remotion/LICENSE.md', 'public/vendor/remotion-LICENSE.md');
await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], outfile: 'public/vendor/visual-effects.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineVisualEffects', legalComments: 'none' });

await build({ entryPoints: ['lib/editor/remotion-transitions-runtime.ts'], outfile: 'public/vendor/remotion-transitions.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineRemotionTransitions', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });
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
// Scene frames run author TypeScript (compiled in the frame by sucrase) against GSAP and its plugins.
await build({ entryPoints: ['lib/editor/scene-runtime.ts'], outfile: 'public/vendor/scene-runtime.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineSceneRuntime', legalComments: 'linked' });
// React scenes (opt-in) load React and their frame adapter from a second file, so GSAP scene frames stay as small as before.
await build({ entryPoints: ['lib/editor/scene-react-runtime.tsx'], outfile: 'public/vendor/scene-react.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineSceneReact', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });
await build({ entryPoints: ['lib/editor/remotion-runtime.ts'], outfile: 'public/vendor/remotion-runtime.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineRemotion', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });
