import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { SCENE_RUNTIME_BUNDLES } from '../../lib/editor/scene-modules.ts';

execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
execFileSync('flock', ['--version'], { stdio: 'ignore' });
if (!existsSync('scripts/render-resources.mjs') || !existsSync('scripts/render-ffmpeg.sh')) throw new Error('Bounded render FFmpeg launcher is missing.');
// Exercise the packaged TypeScript import graph without claiming work or calling
// providers. This catches missing server files and aliases during the image build.
execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`
  await import('./lib/server/media-task-runner.ts');
  const {AnalysisError,isRetryableAnalysisError}=await import('./lib/media-analysis/errors.ts');
  if(!isRetryableAnalysisError(new AnalysisError('temporary',429,true))||isRetryableAnalysisError(new AnalysisError('quota',429,false)))throw new Error('Media retry policy is invalid.');
`],{stdio:'inherit'});
// The Fly exports image renders only; its Python trackers and models are left out.
const exportsOnly = process.env.REVLINE_RUNTIME_CHECK === 'exports';
if (!exportsOnly) {
  if (!existsSync('scripts/detect-facecam.py') || !existsSync('public/vendor/face-landmarker.task')) throw new Error('Local clipping vision assets are missing.');
  if (!existsSync('scripts/track-pixels.py')) throw new Error('Pixel tracker entry point is missing.');
  execFileSync(process.env.BEAT_TRACK_PYTHON, ['-c', 'import beat_this, torch, numpy, soxr; assert not torch.cuda.is_available()'], { stdio: 'inherit' });
  execFileSync(process.env.SCENE_DETECT_PYTHON, ['-c', "import scenedetect, cv2; assert hasattr(cv2, 'calcOpticalFlowPyrLK') and hasattr(cv2, 'estimateAffinePartial2D')"], { stdio: 'inherit' });
  execFileSync(process.env.YT_DLP_PATH, ['--version'], { stdio: 'ignore' });
  if (!existsSync(process.env.BEAT_TRACK_MODEL_PATH)) throw new Error('Pinned beat model is missing.');
}
if (!existsSync(await puppeteer.executablePath())) throw new Error('Chromium is missing.');
for (const path of ['public/vendor/remotion-runtime.js', 'public/vendor/remotion-text.js', 'public/vendor/remotion-transitions.js', 'public/vendor/visual-effects.js', ...Object.values(SCENE_RUNTIME_BUNDLES).map(bundle => `public/vendor/${bundle.file}`), 'public/vendor/lucide-icons.json', 'public/vendor/blaze-face.tflite', 'public/vendor/mediapipe/vision_wasm_internal.wasm']) {
  if (!existsSync(path)) throw new Error(`Required preview/export asset is missing: ${path}`);
}
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setContent('<p>Media runtime check</p>');
  if (await page.$eval('p', element => element.textContent) !== 'Media runtime check') throw new Error('Chromium could not render.');
} finally { await browser.close(); }
console.log(exportsOnly ? 'Export runtime: server imports, retry policy, FFmpeg, Chromium and export assets verified.' : 'Media runtime: server imports, retry policy, FFmpeg, Python trackers, pinned model, Chromium and export assets verified.');
