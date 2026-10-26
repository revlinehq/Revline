import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {animateDemoCutPreview} from './components/editor/demo-cut-preview';
import {f1RecordingDemoPlan} from './lib/editor/f1-recording-demo';
import './components/editor/scripted-demo-editor.css';
const plan=f1RecordingDemoPlan('smoke'),root=createRoot(document.getElementById('timeline'));
const render=timeline=>flushSync(()=>root.render(<>{timeline.clips.map(clip=><div key={clip.id} className={'timeline-clip clip-'+clip.kind} data-clip-id={clip.id} role="button" style={{position:'absolute',left:clip.start*10,top:clip.kind==='audio'?95:30,width:clip.duration*10,height:45,background:clip.kind==='audio'?'#8761c5':'#4b6374'}}><canvas width="20" height="8"/>{clip.kind}</div>)}</>));
window.resetFixture=()=>{render(plan.initial);window.phase='idle';document.querySelectorAll('canvas').forEach(canvas=>{const ctx=canvas.getContext('2d');ctx.fillStyle='#55ddaa';ctx.fillRect(0,0,20,8)});window.first=document.querySelector('[data-clip-id="smoke-section-0"]');window.player=document.querySelector('video');};
window.startFixture=()=>{window.phases=[];window.commits=0;window.controller=new AbortController();window.completion=animateDemoCutPreview(document.querySelector('.scripted-editor-demo'),plan.cutPreview,window.controller.signal,()=>{window.commits++;render(plan.cutPreview.timeline);},phase=>{window.phase=phase;window.phases.push({phase,time:performance.now()});}).then(()=>({ok:true}),error=>({ok:false,error:String(error)}));};
window.resetFixture();
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-demo-cut-test', define: { 'process.env.NODE_ENV': '"development"' } });
const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<html><body></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 760, height: 380 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.setContent('<div class="scripted-editor-demo" data-demo-id="f1-take-1"><video></video><div class="rail"><div class="timeline-track-area"><div id="timeline"></div></div></div></div>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: 'body{margin:0;background:#171719;color:#eee;font:12px Arial}.scripted-editor-demo{padding:24px;height:auto}.rail{width:500px;height:180px;overflow:auto}.timeline-track-area{position:relative;width:920px;height:160px}.timeline-clip{overflow:hidden;border-radius:6px}.demo-cut-preview{--ws-muted:#bbb}canvas{display:block}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.evaluate(() => { document.querySelector('.rail').scrollLeft = 40; window.startFixture(); });
  await page.waitForSelector('.demo-cut-shade');
  assert.equal(await page.$eval('.demo-cut-label', node => node.textContent), 'Trimming');
  assert.equal(await page.evaluate(() => {
    const shade = document.querySelector('.demo-cut-shade').getBoundingClientRect(), removed = document.querySelector('[data-clip-id="smoke-section-1"]').getBoundingClientRect();
    const pixel = document.querySelector('[data-demo-copy-of="smoke-section-2-audio"] canvas').getContext('2d').getImageData(0, 0, 1, 1).data;
    return Math.abs(shade.left-removed.left)<.1 && Math.abs(shade.width-70)<.1 && pixel[1]===221 && pixel[3]===255 && window.commits===0;
  }), true, 'Preview uses actual scrolled clip geometry and preserves waveform canvas pixels without an early save');
  await page.evaluate(() => { document.querySelector('.rail').scrollLeft = 80; });
  assert.equal(await page.evaluate(() => Math.abs(document.querySelector('.demo-cut-shade').getBoundingClientRect().left-document.querySelector('[data-clip-id="smoke-section-1"]').getBoundingClientRect().left)<.1), true, 'Preview follows horizontal scrolling');
  await page.waitForFunction(() => window.phase === 'closing');
  await page.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-demo-copy-of="smoke-section-2"]')).transform).m41 < -10);
  assert.equal(await page.evaluate(() => {
    const x = id => new DOMMatrix(getComputedStyle(document.querySelector('[data-demo-copy-of="'+id+'"]')).transform).m41;
    return Math.abs(x('smoke-section-2')-x('smoke-section-2-audio'))<.1 && window.commits===0;
  }), true, 'Video and linked audio close the gap together before the canonical cut is saved');
  assert.deepEqual(await page.evaluate(() => window.completion), { ok: true });
  const phases=await page.evaluate(()=>window.phases);const at=name=>phases.find(item=>item.phase===name).time;
  assert.ok(at('closing')-at('planned')>=1900,'The planned region remains readable through a 1.5s hold and half-second fade');
  assert.ok(at('committed')-at('closing')>=1700,'Linked clips close the gap over 1.5s and briefly settle before the single save');
  assert.equal(await page.evaluate(() => window.commits===1 && !document.querySelector('.demo-cut-preview') && window.first===document.querySelector('[data-clip-id="smoke-section-0"]') && window.player===document.querySelector('video') && [...document.querySelectorAll('[data-clip-id]')].every(node => node.style.visibility!=='hidden')), true, 'One save removes overlays, restores visibility and retains player/kept-node identity');

  await page.evaluate(() => { window.resetFixture(); window.startFixture(); });
  await page.waitForFunction(() => window.phase === 'closing');
  await page.evaluate(() => window.controller.abort());
  assert.equal((await page.evaluate(() => window.completion)).ok, false);
  assert.equal(await page.evaluate(() => window.commits===0 && !document.querySelector('.demo-cut-preview') && document.querySelectorAll('[data-clip-id]').length===6 && [...document.querySelectorAll('[data-clip-id]')].every(node => node.style.visibility!=='hidden')), true, 'Stop during closure restores the full source without a ghost clip or partial save');

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluate(() => { window.resetFixture(); window.startFixture(); });
  assert.deepEqual(await page.evaluate(() => window.completion), { ok: true });
  assert.equal(await page.evaluate(() => window.commits===1 && !document.querySelector('.demo-cut-preview') && document.getAnimations().length===0), true, 'Reduced motion still commits exactly once and leaves no animation behind');

  await page.evaluate(() => { window.resetFixture(); document.querySelector('.scripted-editor-demo').dataset.demoId='real-project'; window.startFixture(); });
  assert.equal((await page.evaluate(() => window.completion)).ok, false);
  assert.equal(await page.evaluate(() => window.commits===0 && !document.querySelector('.demo-cut-preview')), true, 'The helper refuses a real-project host');
  assert.deepEqual(errors, []);
  console.log('Demo cut preview: scrolled geometry, linked motion, canvas pixels, one commit, Stop cleanup, reduced motion and route isolation passed.');
} finally { await browser.close(); server.close(); }
