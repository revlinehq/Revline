import { copyFileSync, mkdirSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { patchHyperframesPlaybackRuntime } from './hyperframes-playback-compat.mjs';
mkdirSync('public/vendor', { recursive: true });
copyFileSync('node_modules/gsap/dist/gsap.min.js', 'public/vendor/gsap.min.js');
const hyperframesVersion=JSON.parse(readFileSync('node_modules/@hyperframes/core/package.json','utf8')).version;
writeFileSync('public/vendor/hyperframe.runtime.iife.js',patchHyperframesPlaybackRuntime(readFileSync('node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js','utf8'),hyperframesVersion));
if(existsSync('node_modules/@mediapipe/tasks-vision/wasm'))cpSync('node_modules/@mediapipe/tasks-vision/wasm','public/vendor/mediapipe',{recursive:true});
await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], outfile: 'public/vendor/visual-effects.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineVisualEffects', legalComments: 'none' });

// Footage transitions: plain DOM, no React or Remotion.
await build({ entryPoints: ['lib/editor/transitions-bundle.ts'], outfile: 'public/vendor/transitions-runtime.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });
await build({ entryPoints: ['lib/editor/text-runtime.ts'], outfile: 'public/vendor/text-runtime.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineTextBundle', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });

