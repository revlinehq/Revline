import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { smoothZoomPatch } from '../lib/editor/smooth-zoom';
import { motionAt } from '../lib/editor/clip-effects';
import type { Clip, MediaAsset, Timeline } from '../lib/editor/types';
import { prepareComposition, writeComposition } from '../lib/server/prepare-composition';
import { runRenderWorker } from '../lib/server/render-worker';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-smooth-zoom-'));
  const files = new Set(['index.html', 'source.svg', 'ui.html', 'ui.js', 'ui.css', 'gsap.min.js', 'visual-effects.js']);
  const server = createServer(async (request, response) => {
    const name = new URL(request.url ?? '/', 'http://fixture').pathname.slice(1) || 'index.html';
    if (!files.has(name)) { response.writeHead(404).end(); return; }
    try { response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html'); response.end(await readFile(join(directory, name))); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    const asset: MediaAsset = { _id: 'source', kind: 'image', fileName: 'source.svg', width: 1920, height: 1080, url: './source.svg' };
    const clip: Clip = { id: 'zoom', kind: 'image', assetId: 'source', track: 1, start: 0, duration: 2.5, sourceStart: 0, fit: 'contain', crop: { left: .05, right: .05, top: .05, bottom: .05 }, transform: { x: .5, y: .5, scale: 1.03, rotation: 2, opacity: 1 } };
    const settings = { start: .2, inDuration: .5, holdDuration: .5, outDuration: .5, scale: 1.7, centerX: .75, centerY: .25, easing: 'ease-in-out' as const };
    const animated = { ...clip, ...smoothZoomPatch(clip, asset, 'landscape', settings) };
    const timeline: Timeline = { fps: 30, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0 }, clips: [animated] };
    await prepareComposition(directory, timeline, [], 'http://127.0.0.1', AbortSignal.timeout(10_000));
    await writeFile(join(directory, 'source.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><pattern id="grid" width="120" height="120" patternUnits="userSpaceOnUse"><path d="M120 0H0V120" fill="none" stroke="#355269" stroke-width="2"/></pattern></defs><path fill="#172c3c" d="M0 0h1920v1080H0z"/><path fill="url(#grid)" d="M0 0h1920v1080H0z"/><rect x="1270" y="185" width="340" height="170" rx="22" fill="#f0ac57"/><path d="M1390 270h100m-50-50v100" stroke="#222" stroke-width="10"/><circle cx="420" cy="720" r="180" fill="#5a958b"/><rect x="44" y="44" width="1832" height="992" fill="none" stroke="#c6d4d8" stroke-width="15"/></svg>');
    await writeComposition(directory, timeline, [asset], { source: './source.svg' }, 720, 30);
    const ui = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{FootageSettings}from'./components/editor/footage-settings';import './components/editor/footage-settings.css';import './components/workspace/workspace-pages.css';function Fixture(){const[clip,setClip]=useState(${JSON.stringify(clip)}),[locked,setLocked]=useState(false);window.currentClip=clip;window.setZoomLocked=setLocked;return <div className="workspace-page preview-inspector"><FootageSettings readOnly={locked} cropping={false} onCrop={()=>{}} clip={clip} asset={${JSON.stringify(asset)}} aspectRatio="landscape" fps={30} onPreview={patch=>window.lastPreview=patch} onChange={patch=>{window.commits=(window.commits||0)+1;setClip(previous=>({...previous,...patch}))}}/></div>};createRoot(document.getElementById('root')).render(<Fixture/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', outdir: directory, define: { 'process.env.NODE_ENV': '"development"' } });
    await writeFile(join(directory, 'ui.js'), ui.outputFiles.find(file => file.path.endsWith('.js'))!.text);
    await writeFile(join(directory, 'ui.css'), ui.outputFiles.find(file => file.path.endsWith('.css'))!.text);
    await writeFile(join(directory, 'ui.html'), '<!doctype html><html data-workspace-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><style>*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font:12px Arial}.preview-inspector{width:320px;max-width:100vw;padding:20px}button,input{font-family:inherit}</style></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const errors: string[] = [];
    browser = await puppeteer.launch({ headless: true, protocolTimeout: 30_000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage(); page.on('pageerror', error => errors.push(String(error)));
    await page.setViewport({ width: 1280, height: 720 }); await page.goto(origin, { waitUntil: 'networkidle0' });
    for (const time of [0, .45, .8, 1.45, 2]) {
      console.log('Checking zoom phase',time);
      const actual = await page.evaluate(time => { const host = window as any; host.__timelines.revline.seek(time, false); const node = document.getElementById('clip-0-motion'); return { scale: Number(host.gsap.getProperty(node, 'scaleX')), x: Number(host.gsap.getProperty(node, 'x')), y: Number(host.gsap.getProperty(node, 'y')) }; }, time);
      const expected = motionAt(animated.motion!, time);
      assert.ok(Math.abs(actual.scale - expected.scale) < 1e-4, `exact-frame scale at ${time}`);
      assert.ok(Math.abs(actual.x - expected.x * 1280) < .01, `source focal X at ${time}`);
      assert.ok(Math.abs(actual.y - expected.y * 720) < .01, `source focal Y at ${time}`);
    }
    await page.evaluate(() => { (window as any).__timelines.revline.seek(.8, false); });
    const preview = Buffer.from(await page.screenshot({ path: '/tmp/revline-smooth-zoom-preview.png' }));
    const reference = await sharp(preview).removeAlpha().raw().toBuffer();
    await page.goto(origin + '/ui.html', { waitUntil: 'networkidle0' }); await page.click('.smooth-zoom-controls>summary');
    await page.$eval('[aria-label="Source focus X"]', input => { const node = input as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, '.75'); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.locator('::-p-aria([name="Apply zoom"][role="button"])').click();
    assert.equal(await page.evaluate(() => (window as any).commits), 1);
    assert.equal(await page.evaluate(() => (window as any).currentClip.smoothZoom.centerX), .75);
    assert.equal(await page.evaluate(() => (window as any).currentClip.sourceStart), 0);
    await page.evaluate(() => (window as any).setZoomLocked(true));
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('.smooth-zoom-actions button')?.disabled);
    assert.equal(await page.$$eval('.smooth-zoom-controls input,.smooth-zoom-controls button', nodes => nodes.every(node => (node as HTMLInputElement).disabled)), true, 'Active AI work disables all zoom authoring controls');
    await page.evaluate(() => (window as any).setZoomLocked(false));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.smooth-zoom-actions button')?.disabled);
    for (const theme of ['dark', 'light']) { await page.setViewport({ width: 360, height: 850 }); await page.evaluate(theme => { document.documentElement.dataset.workspaceTheme = theme; }, theme); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(await page.$$eval('.smooth-zoom-timing input', nodes => nodes.every(node => node.getBoundingClientRect().right <= document.querySelector('.smooth-zoom-timing')!.getBoundingClientRect().right + 1)), true, 'Timing inputs stay inside their inspector grid'); await page.screenshot({ path: `/tmp/revline-smooth-zoom-controls-${theme}.png`, fullPage: true }); }
    assert.deepEqual(errors, []);
    await browser.close(); browser = undefined;
    const output = join(directory, 'zoom.mp4'); const result = await runRenderWorker(directory, output, { fps: 30, quality: 'high' }, () => {}, AbortSignal.timeout(120_000)); assert.equal(result.warnings, 0);
    const exported = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.8', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 10 * 1024 * 1024 });
    assert.equal(exported.length, reference.length); let difference = 0; for (let index = 0; index < reference.length; index++) difference += Math.abs(reference[index] - exported[index]);
    const error = difference / reference.length; assert.ok(error < 4, `Preview/native MP4 mean pixel difference ${error}`);
    await copyFile(output, '/tmp/revline-smooth-zoom.mp4');
    console.log(`PASS: five exact motion phases, source focus/crop/static transform, development controls/apply, 360px light/dark, and actual 720p MP4 agree (mean pixel error ${error.toFixed(3)}/255). No AI calls or user edits.`);
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
