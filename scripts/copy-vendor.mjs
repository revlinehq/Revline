import { copyFileSync, mkdirSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
// Scene frames run author code with React; sucrase compiles their JSX in the frame.
await build({ entryPoints: ['lib/editor/scene-runtime.tsx'], outfile: 'public/vendor/scene-runtime.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineSceneRuntime', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });
await build({ entryPoints: ['lib/editor/remotion-runtime.ts'], outfile: 'public/vendor/remotion-runtime.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineRemotion', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });
