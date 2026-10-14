import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// Exercise real decoded 1080p video, live splits, stacked FX and discontinuous
// source offsets. A tiny no-FX MP4 cannot detect the effect/decoder regressions.
const width = Number(process.env.REVLINE_SOURCE_WIDTH ?? 1920), height = Math.round(width * 9 / 16);
const directory = await mkdtemp(join(tmpdir(), 'revline-playback-'));
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=30`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '19', '-threads', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', join(directory, 'source.mp4')]);
const media = await readFile(join(directory, 'source.mp4'));
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{useState,useRef} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {Preview} from './components/editor/preview';
      import {EditorStateProvider} from './components/editor/editor-state';
      import {createEditorStore} from './lib/editor/store';
      import {splitClip} from './lib/editor/operations';
      import {motionPreset} from './lib/editor/clip-effects';
      import {DEFAULT_DITHER,DEFAULT_ZOOM_BLUR} from './lib/editor/visual-effects';
      const initial={fps:30,aspectRatio:'landscape',clips:[0,8,16].flatMap((sourceStart,index)=>[
        {id:'video-'+index,kind:'video',assetId:'video',start:index*2,duration:2,sourceStart,volume:0,
          dither:{...DEFAULT_DITHER,enabled:${!process.env.REVLINE_NO_FX},size:${Number(process.env.REVLINE_DITHER_SIZE??2)}},
          zoomBlur:{...DEFAULT_ZOOM_BLUR,enabled:${!process.env.REVLINE_NO_FX},amount:.25}},
        {id:'audio-'+index,kind:'audio',assetId:'audio',start:index*2,duration:2,sourceStart,volume:.25}
      ])};
      const store=createEditorStore(initial);
      function Fixture(){
        const [timeline,setTimeline]=useState(initial),ref=useRef(null);
        window.fixtureTimeline=timeline;
        window.playPreview=()=>ref.current.play();window.pausePreview=()=>ref.current.pause();window.seekPreview=time=>ref.current.seek(time);
        window.apply=next=>flushSync(()=>setTimeline(next));
        window.splitAndAddFX=()=>{
          let next=splitClip(splitClip(timeline,'video-0',1,'video-tail'),'audio-0',1,'audio-tail');
          if(!${!!process.env.REVLINE_NO_FX})for(const [index,preset] of ['shake','quick-zoom-in'].entries()){
            const clip={id:'fx-'+index,kind:'effect',start:0,duration:6,sourceStart:0,track:index+1};
            next={...next,clips:[...next.clips,{...clip,...motionPreset(clip,preset)}]};
          }
          if(${!!process.env.REVLINE_STACKED_BLUR}&&!${!!process.env.REVLINE_NO_FX})for(let index=0;index<2;index++){
            const clip={id:'blur-'+index,kind:'effect',start:0,duration:6,sourceStart:0,track:index+3};
            next={...next,clips:[...next.clips,{...clip,...motionPreset(clip,'zoom-blur'),zoomBlur:{...DEFAULT_ZOOM_BLUR,enabled:true,amount:.15}}]};
          }
          window.apply(next);
        };
        return <EditorStateProvider store={store}>
          <button id="play" onClick={()=>ref.current.play()}>Play</button>
          <Preview ref={ref} timeline={timeline} assets={[
            {_id:'video',kind:'video',fileName:'Synthetic 1080p',width:${width},height:${height},url:location.origin+'/source.mp4'},
            {_id:'audio',kind:'audio',fileName:'Synthetic tone',url:location.origin+'/source.mp4'}
          ]} time={0} muted={false} onTime={t=>store.setState({playhead:t})}
            onPlaying={playing=>store.setState({playing})} onError={e=>(window.errors??=[]).push(e)}/>
        </EditorStateProvider>
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);`
  },
  plugins: process.env.REVLINE_DISABLE_WARMUP ? [{ name: 'baseline', setup(build) { build.onLoad({ filter: /preview-media-warmup\.ts$/ }, () => ({ contents: 'export const warmPreviewMedia=()=>()=>{};', loader: 'ts' })); } }] : [],
  bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
  outdir: '/tmp/revline-playback-bundle', define: { 'process.env.NODE_ENV': '"production"' }
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/bundle.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(js); }
  if (url.pathname === '/source.mp4') {
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) });
    return res.end(media.subarray(start, end + 1));
  }
  if (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/fonts/')) {
    try { res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.woff2') ? 'font/woff2' : 'text/javascript' }); return res.end(await readFile('public' + url.pathname)); }
    catch { res.writeHead(404); return res.end(); }
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<style>${css}body{margin:0}.preview-canvas{position:relative;width:640px;height:360px}.hyperframes-host{position:absolute;inset:0}</style><div id="root"></div><script src="/bundle.js"></script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=768'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', async request => {
    if (request.url().includes('hyperframe.runtime.iife.js')) return request.respond({ status: 200, contentType: 'text/javascript', body: await readFile('node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js') });
    request.continue();
  });
  await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.style.zIndex === '1');
  await page.evaluate(() => {
    const p = document.querySelector('hyperframes-player'), doc = p.iframeElement.contentDocument;
    window.baseline = { p, doc, video: doc.querySelector('video'), audio: doc.querySelector('audio') };
    window.sourceLoads = 0;
    for (const node of doc.querySelectorAll('video,audio')) node.addEventListener('loadstart', () => window.sourceLoads++);
    window.shaderCalls=[];window.framebufferAllocations=0;
    const proto=doc.defaultView.WebGLRenderingContext.prototype,draw=proto.drawArrays,create=proto.createFramebuffer;
    proto.drawArrays=function(...args){const started=performance.now(),result=draw.apply(this,args);window.shaderCalls.push(performance.now()-started);return result;};
    proto.createFramebuffer=function(...args){window.framebufferAllocations++;return create.apply(this,args);};
    window.splitAndAddFX();
  });
  await page.waitForFunction(() => {
    const node = window.baseline.doc.querySelector('[data-source-clip="video-tail"]');
    return node?.readyState >= 2 && !node.seeking && Math.abs(node.currentTime - 1) < .02;
  }).catch(async error=>{console.log('Split readiness failure',await page.evaluate(()=>({errors:window.errors,nodes:Array.from(window.baseline.doc.querySelectorAll('video,audio'),node=>({id:node.dataset.sourceClip,start:node.dataset.start,sourceStart:node.dataset.mediaStart,ready:node.readyState,time:node.currentTime,seeking:node.seeking})),retained:window.baseline.doc===document.querySelector('hyperframes-player').iframeElement.contentDocument})));throw error;});
  assert.equal(await page.evaluate(() => {
    const { p, doc, video, audio } = window.baseline;
    return document.querySelector('hyperframes-player') === p && p.iframeElement.contentDocument === doc && doc.querySelector('[data-source-clip="video-0"]') === video && doc.querySelector('[data-source-clip="audio-0"]') === audio;
  }), true, 'Splitting and adding stacked FX retains the player, document and surviving decoders');
  const sizes = await page.evaluate(() => ({
    viewport: [window.baseline.doc.defaultView.innerWidth, window.baseline.doc.defaultView.innerHeight],
    displayed: [window.baseline.p.iframeElement.getBoundingClientRect().width, window.baseline.p.iframeElement.getBoundingClientRect().height],
    effects: Array.from(window.baseline.doc.querySelectorAll('.visual-effect-output'), node => [node.width, node.height])
  }));
  console.log('Real decoded source / preview FX sizes', { source: [width, height], ...sizes });
  if (!process.env.REVLINE_NO_FX) assert.ok(sizes.effects.length && sizes.effects.every(([w, h]) => w <= 1280 && h <= 720), 'Effect canvas density follows the displayed preview, not its full-resolution iframe viewport');
  await page.evaluate(() => {
    window.frames = [];
    const { doc } = window.baseline;
    for (const video of doc.querySelectorAll('video')) {
      video.requestVideoFrameCallback(function next(now, meta) {
        const timeline = doc.defaultView.__timelines.revline;
        const clock = (timeline.__hfReal ?? timeline).time(), start = Number(video.dataset.start), end = Number(video.dataset.end);
        if (clock >= start && clock < end) {
          const audio = Array.from(doc.querySelectorAll('audio')).find(node => clock >= Number(node.dataset.start) && clock < Number(node.dataset.end));
          window.frames.push({ id: video.dataset.sourceClip, now, clock, mediaTime: meta.mediaTime, audioTime: audio?.currentTime, expected: Number(video.dataset.mediaStart) + clock - start });
        }
        video.requestVideoFrameCallback(next);
      });
    }
  });
  await page.click('#play');
  await page.waitForFunction(() => window.baseline.p.currentTime > 5.6);
  const frames = await page.evaluate(() => window.frames);
  const samples = frames.filter(frame => frame.clock > .2 && frame.clock < 5.5);
  const gaps = samples.slice(1).map((frame, index) => frame.now - samples[index].now).filter(gap => gap > 0);
  const sorted = [...gaps].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * .95)];
  const drift = samples.filter(frame => frame.audioTime != null).map(frame => Math.abs(frame.mediaTime - frame.audioTime));
  const metrics = { decodedFrames: samples.length, fps: Number((samples.length / 5.3).toFixed(1)), p95GapMs: Math.round(p95), maxGapMs: Math.round(Math.max(...gaps)), maxAudioVideoOffsetMs: Math.round(Math.max(...drift) * 1000) };
  console.log('Decoded presentation with dither, zoom blur and stacked motion FX', metrics);
  const shader = await page.evaluate(() => { const sorted=[...window.shaderCalls].sort((a,b)=>a-b);return {passes:sorted.length,p95SubmissionMs:sorted[Math.floor(sorted.length*.95)],framebufferAllocations:window.framebufferAllocations,activeCanvas:Array.from(window.baseline.doc.querySelectorAll('.visual-effect-output'),node=>[node.width,node.height])}; });
  console.log('GPU pass submission cost (CPU only), retained intermediate allocation', shader);
  if(process.env.REVLINE_STACKED_BLUR)assert.ok(shader.framebufferAllocations<=2,'Intermediate GPU targets are reused across clip handoffs');
  assert.ok(metrics.fps >= 20 && p95 < 120, 'Decoded video continues presenting during the 1080p FX review');
  assert.ok(Math.max(...drift) < .18, 'Paired source audio and decoded video stay aligned');
  const cuts = [{ time: 1, before: 'video-0', after: 'video-tail' }, { time: 2, before: 'video-tail', after: 'video-1' }, { time: 4, before: 'video-1', after: 'video-2' }];
  const handoffs=[];
  for (const cut of cuts) {
    const left = frames.filter(frame => frame.id === cut.before && frame.clock < cut.time).at(-1), right = frames.find(frame => frame.id === cut.after && frame.clock >= cut.time);
    assert.ok(left && right, 'Both sides of the cut produce decoded frames');
    const gap = right.now - left.now;
    console.log('Decoded cut handoff', { timelineTime: cut.time, sourceTime: right.mediaTime, gapMs: Math.round(gap) });
    handoffs.push(gap);
    assert.ok(Math.abs(right.mediaTime - right.expected) < .18, 'Cut activation does not skip forward to catch up with a clock that advanced while loading');
  }
  await page.evaluate(() => { window.pausePreview(); window.seekPreview(4.2); });
  await page.waitForFunction(() => { const node = window.baseline.doc.querySelector('[data-source-clip="video-2"]'); return !node.seeking && node.readyState >= 2 && Math.abs(node.currentTime - 16.2) < .05; });
  const resumes = [], pausedSeekSettlement = [];
  for (let index = 0; index < 3; index++) {
    const pausedAt = await page.evaluate(() => { window.pausePreview(); return performance.now(); });
    await new Promise(resolve => setTimeout(resolve, 80));
    // The upstream player seeks to its exact audio-clock position on pause.
    // Report that native seek separately from an already decoded warm resume.
    await page.waitForFunction(() => { const video = window.baseline.doc.querySelector('[data-source-clip="video-2"]'); return video.paused && !video.seeking && video.readyState >= 2; });
    pausedSeekSettlement.push(Math.round(await page.evaluate(() => performance.now()) - pausedAt));
    const elapsed = await page.evaluate(async () => {
      const { p, doc } = window.baseline, video = doc.querySelector('[data-source-clip="video-2"]'), start = performance.now();
      const frame = new Promise(resolve => video.requestVideoFrameCallback(() => resolve(performance.now() - start)));
      window.playPreview(); return frame;
    });
    resumes.push(Math.round(elapsed));
  }
  console.log('Repeated pause/resume to first decoded frame (ms)', resumes);
  console.log('Pause native seek settlement, including 80ms idle (ms)', pausedSeekSettlement);
  assert.ok(resumes.every(ms => ms < 200), 'Pause/resume does not stall or reload effected footage');
  assert.ok(handoffs.every(gap=>gap<160),'Split/source-jump handoff avoids the transparent-video decoder stall');
  assert.equal(await page.evaluate(() => window.sourceLoads), 0, 'Live split and FX edits never reload surviving sources');
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.errors ?? []), []);
  console.log('PASS: owned real 1080p decoded media, live paired split + FX insertion, continuous and discontinuous source cuts, AV alignment, retained decoders and repeated resume. Software WebGL fixture; real-project network/GPU behavior still needs verification.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
