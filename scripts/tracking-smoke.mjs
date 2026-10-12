import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import puppeteer from 'puppeteer-core';

const base = process.env.REVLINE_TEST_ORIGIN || 'http://localhost:3001';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Tracking fixtures require a local editor.');
const directory = await mkdtemp(join(tmpdir(), 'revline-tracking-test-'));
let browser;
try {
  // Official MediaPipe test image; used only as an ephemeral detection fixture.
  const image = await fetch('https://storage.googleapis.com/mediapipe-assets/portrait.jpg');
  assert.ok(image.ok);
  const portrait = join(directory, 'portrait.jpg');
  const video = join(directory, 'moving-face.mp4');
  await writeFile(portrait, Buffer.from(await image.arrayBuffer()));
  execFileSync('ffmpeg', ['-v', 'error', '-loop', '1', '-i', portrait, '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=24:d=15', '-filter_complex', "[0:v]crop=500:500:150:0,scale=220:220[face];[1:v][face]overlay=x='(W-w)*t/15':y=70:shortest=1[v]", '-map', '[v]', '-t', '15', '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video]);
  const bundle = await build({ stdin: { contents: "export {trackFace} from './lib/editor/tracking'; export {generateComposition,calculateVisualRect} from './lib/editor/composition';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'iife', globalName: 'RevlineTrackingTest', logLevel: 'silent' });
  const installed = await getInstalledBrowsers({ cacheDir: process.env.PUPPETEER_CACHE_DIR || join(homedir(), '.cache/puppeteer') });
  const chrome = installed.find(candidate => candidate.browser === 'chrome');
  assert.ok(chrome, 'Install Chrome for Puppeteer before running tracking fixtures.');
  browser = await puppeteer.launch({ executablePath: chrome.executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(base + '/editor/demo', { waitUntil: 'networkidle2', timeout: 60_000 });
  assert.equal(response.status(), 200, 'The local editor must remain healthy.');
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const data = (await readFile(video)).toString('base64');
  const result = await page.evaluate(async ({ data, base }) => {
    const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const asset = { _id: 'local-tracking-fixture', kind: 'video', fileName: 'moving-face.mp4', width: 640, height: 360, duration: 15, url };
    const progress = [];
    const focus = await RevlineTrackingTest.trackFace(asset, percent => progress.push(percent));
    const player = document.createElement('hyperframes-player');
    player.style.cssText = 'position:fixed;inset:0;width:360px;height:640px;z-index:9999;';
    player.setAttribute('srcdoc', RevlineTrackingTest.generateComposition({ fps: 24, aspectRatio: 'vertical', clips: [{ id: 'follow', kind: 'video', assetId: asset._id, start: 0, sourceStart: 0, duration: 15, volume: 0, focus }] }, [asset], { gsapUrl: base + '/vendor/gsap.min.js' }));
    const ready = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Tracked preview did not load.')), 20_000); player.addEventListener('ready', () => { clearTimeout(timer); resolve(); }, { once: true }); });
    document.body.append(player);
    await ready;
    const positions = [];
    for (const time of [0, 0.5, 7.5, 14.5]) {
      player.seek(time);
      await new Promise(resolve => setTimeout(resolve, 150));
      const frame = player.iframeElement.contentWindow;
      const media = frame.document.querySelector('video');
      positions.push({ time, left: parseFloat(frame.getComputedStyle(media).left), top: parseFloat(frame.getComputedStyle(media).top), opacity: frame.getComputedStyle(media).opacity, visibility: frame.getComputedStyle(media).visibility, decoded: media.readyState >= 2 });
    }
    player.remove();
    URL.revokeObjectURL(url);
    return { count: focus.length, first: focus[0], last: focus.at(-1), progress: progress.at(-1), positions };
  }, { data, base });
  assert.ok(result.count >= 28, 'Actual face detection produced too few source keyframes.');
  assert.equal(result.first.time, 0, 'First decoded frame must detect the face.');
  assert.ok(result.last.x - result.first.x > 0.5, 'The detector did not follow the moving face.');
  assert.equal(result.progress, 100);
  assert.ok(result.positions.every(frame => frame.opacity === '1' && frame.visibility === 'visible' && frame.decoded), 'Tracked preview contains invisible or undecoded media.');
  assert.ok(result.positions[0].left - result.positions.at(-1).left > 1000, 'Preview crop did not follow the detected source coordinates.');
  assert.deepEqual(errors, []);
  console.log('Real browser tracking passed:', JSON.stringify(result));
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
