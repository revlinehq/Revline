import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { generateComposition } from '../lib/editor/composition.ts';

const sharp = createRequire(import.meta.url)('sharp');
const video = !!process.env.REVLINE_COMPOSITING_VIDEO;
const directory = video ? await mkdtemp(join(tmpdir(), 'revline-compositing-')) : null;
let media;
if (video) {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:size=1920x1080:rate=30', '-t', '5', '-vf', 'scale=in_color_matrix=bt601:out_color_matrix=bt709', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-threads', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(directory, 'red.mp4')]);
  media = await readFile(join(directory, 'red.mp4'));
}
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React,{useRef} from 'react';import{createRoot}from'react-dom/client';
  import{Preview}from'./components/editor/preview';
  import{EditorStateProvider,useEditorState}from'./components/editor/editor-state';
  import{createEditorStore}from'./lib/editor/store';
  const timeline={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:0,effects:0},clips:[
    {id:'blue',kind:'image',assetId:'blue',track:1,start:0,duration:5,sourceStart:0},
    {id:'red',kind:'${video ? 'video' : 'image'}',assetId:'red',track:2,start:0,duration:5,sourceStart:0,volume:0}
  ]},store=createEditorStore(timeline);
  const assets=['blue','red'].map(color=>({_id:color,kind:color==='red'?'${video ? 'video' : 'image'}':'image',fileName:'Owned '+color+' fixture',width:color==='red'?1920:32,height:color==='red'?1080:18,url:location.origin+'/'+color+(color==='red'&&${video}?'.mp4':'.svg')}));
  function Fixture(){const timeline=useEditorState(s=>s.timeline),ref=useRef(null);
    window.fixture={seek:t=>ref.current.seek(t),timeline:()=>store.getState().timeline,patch:(id,patch)=>store.getState().edit({...store.getState().timeline,clips:store.getState().timeline.clips.map(clip=>clip.id===id?{...clip,...patch}:clip)}),reorder:()=>store.getState().edit({...store.getState().timeline,clips:store.getState().timeline.clips.map(clip=>({...clip,track:clip.track===1?2:1}))})};
    return <div className="stage"><Preview ref={ref} timeline={timeline} assets={assets} time={0} muted onTime={()=>{}} onPlaying={()=>{}} onError={error=>(window.errors??=[]).push(error)}/></div>;
  }createRoot(document.getElementById('root')).render(<EditorStateProvider store={store}><Fixture/></EditorStateProvider>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-compositing-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const runtime = await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: '__revlineVisualEffects', write: false });
const warmup = video ? await build({ entryPoints: ['lib/editor/preview-media-warmup.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: '__revlineWarmup', write: false }) : null;
let exported;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (path === '/red.mp4' && media) {
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }); return response.end(media.subarray(start, end + 1));
  }
  const color = path.slice(1, -4);
  let body = path === '/fixture.js' ? bundle.outputFiles.find(file => file.path.endsWith('.js')).text : path === '/vendor/visual-effects.js' ? runtime.outputFiles[0].text : path === '/export' ? exported : ['blue', 'red'].includes(color) ? `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="${color}"/></svg>` : null;
  if (path.startsWith('/vendor/') || path.startsWith('/fonts/')) body ??= await readFile('public' + path).catch(() => null);
  body ??= '<style>body{margin:0}.stage,.preview-canvas{width:640px;height:360px;position:relative}.hyperframes-host{position:absolute;inset:0}</style><div id="root"></div><script src="/fixture.js"></script>';
  response.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.woff2') ? 'font/woff2' : 'text/html' }); response.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=768'] });
const page = await browser.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function check(label, expected, selector = '.stage') {
  await settle();
  const { data, info } = await sharp(await (await page.$(selector)).screenshot()).raw().toBuffer({ resolveWithObject: true });
  const at = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  const actual = [...data.subarray(at, at + 3)], passed = actual.every((value, index) => Math.abs(value - expected[index]) <= 4);
  checks.push({ label, expected, actual, passed }); console.log(JSON.stringify(checks.at(-1)));
}
try {
  await page.setViewport({ width: 1000, height: 1000 }); await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.style.zIndex === '1');
  await page.evaluate(() => { const p = document.querySelector('hyperframes-player'); window.original = { player: p, document: p.iframeElement.contentDocument, source: p.iframeElement.contentDocument.querySelector('[data-source-clip="red"]') }; window.fixture.seek(1); });
  await check('Initial V2 overlays V1', [255, 0, 0]);
  await page.evaluate(() => window.fixture.patch('red', { blendMode: 'screen' })); await check('Live Screen blends two layers', [255, 0, 255]);
  await page.evaluate(() => window.fixture.patch('red', { blendMode: 'normal', invert: { enabled: true, amount: 1 } }));
  await page.waitForFunction(() => document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelector('.visual-effect-output'));
  await check('GPU effect replaces the upper source', [0, 255, 255]);
  await page.evaluate(() => window.fixture.patch('red', { transform: { x: .5, y: .5, scale: 1, rotation: 0, opacity: .5 } })); await check('GPU output honors clip opacity over lower layer', [0, 128, 255]);
  await page.evaluate(() => window.fixture.patch('red', { blendMode: 'multiply', transform: { x: .5, y: .5, scale: 1, rotation: 0, opacity: 1 } })); await check('GPU output honors Multiply', [0, 0, 255]);
  await page.evaluate(() => window.fixture.patch('red', { blendMode: 'normal', invert: { enabled: false, amount: 1 } }));
  await check('Bypass restores upper native source', [255, 0, 0]);
  await page.evaluate(() => window.fixture.reorder()); await check('Live V-track reorder changes compositing order', [0, 0, 255]);
  const saved = await page.evaluate(() => window.fixture.timeline());
  exported = generateComposition(saved, ['blue', 'red'].map(color => ({ _id: color, kind: color === 'red' && video ? 'video' : 'image', fileName: 'Owned fixture', width: 1920, height: 1080, url: origin + '/' + color + (color === 'red' && video ? '.mp4' : '.svg') })), { gsapUrl: origin + '/vendor/gsap.min.js' });
  await page.evaluate(origin => { const frame = document.createElement('iframe'); frame.id = 'exported'; frame.style.cssText = 'display:block;width:1920px;height:1080px;border:0;transform:scale(.3333333333);transform-origin:top left'; frame.src = origin + '/export'; document.body.appendChild(frame); }, origin);
  await page.waitForFunction(() => document.getElementById('exported').contentWindow.__revlineAdjustmentController);
  await page.evaluate(async () => { const win = document.getElementById('exported').contentWindow; await Promise.all(Array.from(win.document.querySelectorAll('img'), image => image.decode())); win.__timelines.revline.seek(1); });
  await check('Fresh export composition follows saved V-track order', [0, 0, 255], '#exported');
  assert.equal(await page.evaluate(() => { const p = document.querySelector('hyperframes-player'); return p === window.original.player && p.iframeElement.contentDocument === window.original.document && p.iframeElement.contentDocument.querySelector('[data-source-clip="red"]') === window.original.source; }), true, 'Compositing edits retain the source and player');
  if (video) {
    await page.addScriptTag({ content: warmup.outputFiles[0].text });
    await page.evaluate(async () => {
      const composition = document.createElement('div'); composition.id = 'composition'; document.body.appendChild(composition);
      const media = document.createElement('video'); media.src = location.origin + '/red.mp4'; media.muted = true; media.style.display = 'none'; media.dataset.start = '1'; media.dataset.mediaStart = '2'; composition.appendChild(media);
      await media.play();
      window.warmFixture = { media, stop: window.__revlineWarmup.warmPreviewMedia(document, () => 0) };
      // Its play state settles after the first warmup tick; the timeline stays paused.
      media.pause(); media.currentTime = 0;
    });
    await page.waitForFunction(() => window.warmFixture.media.paused && !window.warmFixture.media.seeking && Math.abs(window.warmFixture.media.currentTime - 2) < .02);
    await page.evaluate(() => { window.warmFixture.stop(); window.warmFixture.media.parentElement.remove(); });
    console.log('PASS: upcoming decoded source retries after its play state settles, while the composition clock remains paused.');
  }
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.errors ?? []), []);
  assert.ok(checks.every(check => check.passed), 'Compositing pixel checks failed: ' + checks.filter(check => !check.passed).map(check => check.label).join(', '));
  console.log('PASS: actual retained preview blend/opacity/GPU bypass/V-track ordering and saved export composition pixels. Synthetic ' + (video ? 'decoded 1080p video' : 'images') + ' only; no MP4 encoder job.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); if (directory) await rm(directory, { recursive: true, force: true }); }
