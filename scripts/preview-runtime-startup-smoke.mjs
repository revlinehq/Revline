import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const directory = await mkdtemp(join(tmpdir(), 'revline-runtime-startup-'));
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '8', '-threads', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(directory, 'video.mp4')]);
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8', '-c:a', 'aac', join(directory, 'audio.m4a')]);
const video = await readFile(join(directory, 'video.mp4')), audio = await readFile(join(directory, 'audio.m4a'));
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';import {Preview} from './components/editor/preview';import {EditorStateProvider} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';
const timeline={fps:30,aspectRatio:'landscape',clips:[{id:'video',kind:'video',assetId:'video',start:0,duration:8,sourceStart:0,volume:0},{id:'audio',kind:'audio',assetId:'audio',start:0,duration:8,sourceStart:0,volume:.1}]};const store=createEditorStore(timeline);window.errors=[];
function Fixture(){const ref=useRef(null);window.fixture={play:()=>ref.current.play(),pause:()=>ref.current.pause(),seek:t=>ref.current.seek(t),retry:()=>ref.current.retry()};return <EditorStateProvider store={store}><Preview ref={ref} timeline={timeline} assets={[{_id:'video',kind:'video',fileName:'Generated video',width:320,height:180,url:location.origin+'/video.mp4'},{_id:'audio',kind:'audio',fileName:'Generated tone',url:location.origin+'/audio.m4a'}]} time={0} muted={false} onTime={t=>store.setState({playhead:t})} onPlaying={playing=>store.setState({playing})} onError={e=>window.errors.push(e)}/></EditorStateProvider>};createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-runtime-startup-bundle', define: { 'process.env.NODE_ENV': '"production"' } });
let runtimeDelay = 0;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (path === '/bundle.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); return response.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); }
  if (path === '/video.mp4' || path === '/audio.m4a') {
    const bytes = path === '/video.mp4' ? video : audio, range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    response.writeHead(range ? 206 : 200, { 'Content-Type': path === '/video.mp4' ? 'video/mp4' : 'audio/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
    return response.end(bytes.subarray(start, end + 1));
  }
  if (path.startsWith('/vendor/') || path.startsWith('/fonts/')) {
    try {
      let bytes = await readFile('public' + path);
      // Reproduce the real iframe/probe race while retaining the actual runtime.
      if (path === '/vendor/hyperframe.runtime.iife.js' && runtimeDelay) bytes = Buffer.from(`setTimeout(function(){\n${bytes}\n},${runtimeDelay});`);
      response.writeHead(200, { 'Content-Type': path.endsWith('.woff2') ? 'font/woff2' : 'text/javascript' }); return response.end(bytes);
    } catch { response.writeHead(404); return response.end(); }
  }
  response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(`<style>${bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''}.preview-canvas{position:relative;width:640px;height:360px}.hyperframes-host{position:absolute;inset:0}</style><div id="root"></div><script src="/bundle.js"></script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const delay of [0, 1200]) {
    runtimeDelay = delay;
    const page = await browser.newPage(), errors = []; page.setDefaultTimeout(10000); await page.setCacheEnabled(false);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('hyperframes-player')?.style.zIndex === '1');
    await page.waitForFunction(() => typeof document.querySelector('hyperframes-player')?.iframeElement.contentWindow.__player?.getTime === 'function');
    const sample = () => page.evaluate(() => {
      const player = document.querySelector('hyperframes-player'), host = player.iframeElement.contentWindow;
      return { parentPaused: player.paused, time: host.__player.getTime(), runtimePlaying: host.__player.isPlaying(), media: Array.from(host.document.querySelectorAll('video,audio'), node => ({ ready: node.readyState, paused: node.paused, sourceTime: node.currentTime })) };
    });
    const start = await sample(); await page.evaluate(() => window.fixture.play());
    await new Promise(resolve => setTimeout(resolve, 700));
    const played = await sample(); console.log(JSON.stringify({ runtimeDelay: delay, played }));
    assert.ok(!played.parentPaused && played.runtimePlaying && played.time > start.time + .2 && played.media.every(node => node.ready >= 3 && !node.paused && node.sourceTime > start.time + .2), 'Play must advance the native runtime and actual A/V, even when the runtime starts after the GSAP probe');
    await page.evaluate(() => window.fixture.pause()); const parked = await sample();
    await new Promise(resolve => setTimeout(resolve, 200)); const paused = await sample();
    assert.ok(paused.parentPaused && !paused.runtimePlaying && Math.abs(paused.time - parked.time) < .05, 'Explicit Pause parks the actual runtime');
    await page.evaluate(() => window.fixture.seek(1.2)); await new Promise(resolve => setTimeout(resolve, 200));
    const sought = await sample(); assert.ok(sought.parentPaused && !sought.runtimePlaying && Math.abs(sought.time - 1.2) < .05, 'Seek lands paused on the native runtime');
    await page.evaluate(() => window.fixture.play());
    await page.waitForFunction(() => document.querySelector('hyperframes-player').iframeElement.contentWindow.__player.getTime() > 1.5);
    await page.evaluate(() => { window.previousPlayer = document.querySelector('hyperframes-player'); window.fixture.retry(); });
    await page.waitForFunction(() => { const player = document.querySelector('hyperframes-player'); return player !== window.previousPlayer && player?.style.zIndex === '1' && player.iframeElement.contentWindow.__player?.isPlaying(); });
    const swapped = await sample(); await new Promise(resolve => setTimeout(resolve, 400)); const resumed = await sample();
    assert.ok(!resumed.parentPaused && resumed.runtimePlaying && resumed.time > swapped.time + .2 && resumed.media.every(node => !node.paused), 'A replacement preview resumes the actual runtime and A/V');
    assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.errors), []);
    console.log(`PASS: runtime delay ${delay}ms; native Play, Pause, seek and replacement resume.`);
    await page.close();
  }
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
