import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const directory = await mkdtemp(join(tmpdir(), 'revline-buffering-'));
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '12', '-threads', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(directory, 'video.mp4')]);
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:a', 'aac', join(directory, 'audio.m4a')]);
const video = await readFile(join(directory, 'video.mp4')), audio = await readFile(join(directory, 'audio.m4a'));
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';import {Preview} from './components/editor/preview';import {EditorStateProvider} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';
const timeline={fps:30,aspectRatio:'landscape',clips:[{id:'video',kind:'video',assetId:'video',start:0,duration:12,sourceStart:0,volume:0},{id:'audio',kind:'audio',assetId:'audio',start:0,duration:12,sourceStart:0,volume:.1}]};const store=createEditorStore(timeline);window.errors=[];
function Fixture(){const ref=useRef(null);window.fixture={play:()=>ref.current.play(),pause:()=>ref.current.pause(),seek:t=>ref.current.seek(t),store};return <EditorStateProvider store={store}><Preview ref={ref} timeline={timeline} assets={[{_id:'video',kind:'video',fileName:'Generated video',width:1280,height:720,url:location.origin+'/video.mp4'},{_id:'audio',kind:'audio',fileName:'Generated tone',url:location.origin+'/audio.m4a'}]} time={0} muted={false} onTime={t=>store.setState({playhead:t})} onPlaying={playing=>store.setState({playing})} onError={e=>window.errors.push(e)}/></EditorStateProvider>};createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-buffering-bundle', define: { 'process.env.NODE_ENV': '"production"' } });
let gate = Promise.withResolvers(), startup = false;
const server = createServer(async (request, response) => {
 const path = new URL(request.url, 'http://127.0.0.1').pathname;
 if (path === '/bundle.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); return response.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); }
 if (path === '/video.mp4' || path === '/audio.m4a') {
  const bytes = path === '/video.mp4' ? video : audio, match = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
  const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
  response.writeHead(match ? 206 : 200, { 'Content-Type': path === '/video.mp4' ? 'video/mp4' : 'audio/mp4', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(match ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
  if (path === '/audio.m4a') return response.end(bytes.subarray(start, end + 1));
  const boundary = Math.min(end + 1, Math.floor((startup ? .3 : 3) * 1024 * 1024));
  if (start < boundary) response.write(bytes.subarray(start, boundary));
  await gate.promise;
  if (!response.destroyed) response.end(bytes.subarray(Math.max(start, boundary), end + 1));
  return;
 }
 if (path.startsWith('/vendor/') || path.startsWith('/fonts/')) {
  try { const bytes = await readFile('public' + path); response.writeHead(200, { 'Content-Type': path.endsWith('.woff2') ? 'font/woff2' : 'text/javascript' }); return response.end(bytes); } catch { response.writeHead(404); return response.end(); }
 }
 response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(`<style>${bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''}.preview-canvas{position:relative;width:640px;height:360px}.hyperframes-host{position:absolute;inset:0}</style><div id="root"></div><script src="/bundle.js"></script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
 browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
 for (const action of ['startup', 'resume', 'pause', 'seek']) {
 startup = action === 'startup';gate = Promise.withResolvers();
 const page = await browser.newPage(); page.setDefaultTimeout(12000);
 await page.setCacheEnabled(false);
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
 if (startup) {
  await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.iframeElement?.contentDocument?.querySelector('video')?.readyState>=2);
  await new Promise(resolve=>setTimeout(resolve,150));
  const early=await page.evaluate(()=>{const player=document.querySelector('hyperframes-player'),video=player.iframeElement.contentDocument.querySelector('video');return{revealed:player.style.zIndex==='1',loading:!!document.querySelector('.preview-loading'),readyState:video.readyState,buffered:video.buffered.length?video.buffered.end(0)-video.currentTime:0};});
  console.log('First decoded frame while initial video bytes are gated',early);
  assert.ok(early.buffered<.5,'Startup fixture withholds more than a single decoded frame');assert.equal(early.revealed,false,'One decoded frame with less than half a second of runway must not mark the preview playable');assert.equal(early.loading,true);
  gate.resolve();
 }
 await page.waitForFunction(() => document.querySelector('hyperframes-player')?.style.zIndex === '1');
 if (startup) {
  const ready=await page.evaluate(()=>{const player=document.querySelector('hyperframes-player'),video=player.iframeElement.contentDocument.querySelector('video');window.startupFrames=[];window.startupWaits=[];const started=performance.now();video.addEventListener('waiting',()=>window.startupWaits.push({ms:performance.now()-started,time:video.currentTime}));video.requestVideoFrameCallback(function next(now,frame){window.startupFrames.push({ms:performance.now()-started,time:frame.mediaTime});video.requestVideoFrameCallback(next);});window.fixture.play();return{buffered:video.buffered.end(0)-video.currentTime,readyState:video.readyState};});
  assert.ok(ready.buffered>=.45,'Playback-ready has a bounded initial buffered runway');
  await page.waitForFunction(()=>document.querySelector('hyperframes-player').currentTime>.8);
  const presented=await page.evaluate(()=>({frames:window.startupFrames.filter(frame=>frame.time>.01),waiting:window.startupWaits}));const gaps=presented.frames.slice(1).map((frame,index)=>frame.ms-presented.frames[index].ms);
  const startupMetrics={...ready,firstFrameMs:Math.round(presented.frames[0]?.ms??Infinity),maxFrameGapMs:Math.round(Math.max(0,...gaps)),waitingEvents:presented.waiting};
  console.log('Actual initial decoded presentation',startupMetrics);assert.ok(startupMetrics.firstFrameMs<350&&startupMetrics.maxFrameGapMs<350,'The first second presents decoded frames without a visible startup freeze');assert.deepEqual(errors,[]);console.log('PASS: initial playback waits for a small buffered runway, not only the first frame.');await page.close();continue;
 }
 await page.evaluate(() => {
  const player = document.querySelector('hyperframes-player'), doc = player.iframeElement.contentDocument, video = doc.querySelector('video'), audio = doc.querySelector('audio');
  window.media = { player, doc, video, audio }; window.clock = () => { const timeline = doc.defaultView.__timelines.revline; return (timeline.__hfReal ?? timeline).time(); };
  video.addEventListener('waiting', () => { if (window.clock() > .2 && window.stallAt === undefined) window.stallAt = window.clock(); });
  window.fixture.play();
 });
 await page.waitForFunction(() => window.stallAt !== undefined);
 await new Promise(resolve => setTimeout(resolve, 600));
 const held = await page.evaluate(() => ({ stallAt: window.stallAt, clock: window.clock(), video: window.media.video.currentTime, audio: window.media.audio.currentTime, ready: window.media.video.readyState }));
 console.log('Actual video-network stall with fully available audio', held);
 assert.ok(held.clock - held.stallAt < .1, 'Timeline must stop advancing while active video has no future decoded data');
 assert.equal(await page.evaluate(() => window.fixture.store.getState().playing), true, 'Buffering preserves user play intent');
 if (action === 'pause') await page.evaluate(() => window.fixture.pause());
 if (action === 'seek') await page.evaluate(() => window.fixture.seek(2));
 gate.resolve();
 const resumeAt = action === 'seek' ? 2 : held.stallAt;
 if (action !== 'resume') {
  await page.waitForFunction(() => window.media.video.readyState >= 3 && !window.media.video.seeking);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await page.evaluate(() => window.fixture.store.getState().playing), false, 'Explicit Pause/seek cancels automatic buffering resume');
  const parked = action === 'seek' ? 2 : held.clock;
  assert.ok(Math.abs(await page.evaluate(() => window.clock()) - parked) < .05, 'Fresh data cannot move an explicitly paused or scrubbed playhead');
  await page.evaluate(() => window.fixture.play());
 }
 await page.waitForFunction(resumeAt => window.clock() > resumeAt + .7, {}, resumeAt);
 const resumed = await page.evaluate(() => ({ clock: window.clock(), video: window.media.video.currentTime, audio: window.media.audio.currentTime, playing: window.fixture.store.getState().playing }));
 assert.ok(Math.abs(resumed.video - resumed.audio) < .15, 'Audio and video resume together after bytes arrive');
 assert.equal(resumed.playing, true);
 assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.errors), []);
 console.log('PASS: real native MP4 buffering parks the timeline/audio and resumes without losing user play intent.', resumed);
 await page.close();
 }
} finally { gate.resolve(); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
