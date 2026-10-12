import { copyFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
mkdirSync('public/vendor', { recursive: true });
copyFileSync('node_modules/gsap/dist/gsap.min.js', 'public/vendor/gsap.min.js');
if(existsSync('node_modules/@mediapipe/tasks-vision/wasm'))cpSync('node_modules/@mediapipe/tasks-vision/wasm','public/vendor/mediapipe',{recursive:true});
