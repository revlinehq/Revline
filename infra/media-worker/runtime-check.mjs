import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
execFileSync(process.env.BEAT_TRACK_PYTHON, ['-c', 'import beat_this, torch, numpy, soxr; assert not torch.cuda.is_available()'], { stdio: 'inherit' });
execFileSync(process.env.SCENE_DETECT_PYTHON, ['-c', 'import scenedetect, cv2'], { stdio: 'inherit' });
execFileSync(process.env.YT_DLP_PATH, ['--version'], { stdio: 'ignore' });
if (!existsSync(process.env.BEAT_TRACK_MODEL_PATH)) throw new Error('Pinned beat model is missing.');
if (!existsSync(await puppeteer.executablePath())) throw new Error('Chromium is missing.');
for (const path of ['public/vendor/remotion-runtime.js', 'public/vendor/remotion-text.js', 'public/vendor/remotion-transitions.js', 'public/vendor/visual-effects.js', 'public/vendor/blaze-face.tflite', 'public/vendor/mediapipe/vision_wasm_internal.wasm']) {
  if (!existsSync(path)) throw new Error(`Required preview/export asset is missing: ${path}`);
}
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setContent('<p>Media runtime check</p>');
  if (await page.$eval('p', element => element.textContent) !== 'Media runtime check') throw new Error('Chromium could not render.');
} finally { await browser.close(); }
console.log('Media runtime: FFmpeg, Python trackers, pinned model, Chromium and export assets verified.');
