import { copyFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
mkdirSync('public/vendor', { recursive: true });
copyFileSync('node_modules/gsap/dist/gsap.min.js', 'public/vendor/gsap.min.js');
if(existsSync('node_modules/@mediapipe/tasks-vision/wasm'))cpSync('node_modules/@mediapipe/tasks-vision/wasm','public/vendor/mediapipe',{recursive:true});
await build({ entryPoints: ['lib/editor/remotion-text-runtime.tsx'], outfile: 'public/vendor/remotion-text.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineRemotionText', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });
copyFileSync('node_modules/remotion/LICENSE.md', 'public/vendor/remotion-LICENSE.md');
await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], outfile: 'public/vendor/visual-effects.js', bundle: true, minify: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: '__revlineVisualEffects', legalComments: 'none' });
