import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {PreviewInspector} from './components/editor/preview-inspector';
import {patchClip} from './lib/editor/operations';
import './components/workspace/workspace-pages.css';import './app/editor.css';
const assets=[{_id:'asset',kind:'image',fileName:'Texture source.png',url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#596e7f"/></svg>'),width:640,height:360}];
function Fixture(){const[timeline,setTimeline]=useState({fps:24,aspectRatio:'landscape',clips:[{id:'source',kind:'image',assetId:'asset',start:0,duration:3,sourceStart:0,track:1}],tracks:{visual:1,overlay:0,audio:0,effects:0}});const[request,setRequest]=useState({category:'texture',requestId:1});window.timeline=timeline;window.tools=()=>setRequest(r=>({...r,requestId:r.requestId+1}));
return <PreviewInspector clip={timeline.clips[0]} timeline={timeline} assets={assets} libraryRequest={request} onLibraryCategoryChange={()=>{}} onUpload={()=>{}} onAdd={()=>{}} upload={null} onCrop={()=>{}} onChange={patch=>{window.commits.push(patch);setTimeline(t=>patchClip(t,'source',patch))}} onPreviewEffects={patch=>window.previews.push(patch)}/>}
window.commits=[];window.previews=[];createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-textures-ui', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(String(error)));
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const button = name => page.locator('::-p-aria([name="' + name + '"][role="button"])');
const controls = key => '[data-effect="' + key + '"]';
async function range(key, label, command) { await page.focus(controls(key) + ' input[aria-label="' + label + '"]'); await page.keyboard.press(command); await flush(); }
try {
  await page.setViewport({ width: 320, height: 900 });
  await page.setContent('<html data-workspace-theme="dark"><body><div id="root" class="conversation-editor"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font:12px Arial}#root{width:320px;height:900px}button{font:inherit}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.waitForSelector('[aria-label="VHS overlay"]');
  for (const key of ['vhs', 'lightLeak']) {
    const name = key === 'vhs' ? 'VHS overlay' : 'Light leak';
    await button(name).click(); await page.waitForSelector(controls(key));
    const expected = key === 'vhs' ? ['Strength', 'Scanlines', 'Tape noise', 'Color bleed', 'Tracking', 'Speed'] : ['Strength', 'Edge position', 'Spread', 'Speed'];
    assert.deepEqual(await page.$$eval(controls(key) + ' input[type="range"]', nodes => nodes.map(node => node.getAttribute('aria-label'))), expected);
    await range(key, 'Strength', 'End'); assert.equal(await page.evaluate(key => window.timeline.clips[0][key].amount, key), 1);
    await range(key, 'Speed', 'Home'); assert.equal(await page.evaluate(key => window.timeline.clips[0][key].speed, key), 0);
    if (key === 'lightLeak') {
      await page.$eval('[aria-label="Light leak color"]', node => { node.value = '#165eff'; node.dispatchEvent(new Event('change', { bubbles: true })); }); await flush();
      assert.equal(await page.evaluate(() => window.timeline.clips[0].lightLeak.color), '#165eff');
      await range(key, 'Edge position', 'End'); assert.equal(await page.evaluate(() => window.timeline.clips[0].lightLeak.position), 1);
    }
    await page.click('[aria-label="Enable ' + name + '"]'); await flush();
    assert.equal(await page.evaluate(key => window.timeline.clips[0][key].enabled, key), false);
    assert.ok(await page.$$eval(controls(key) + ' input[type="range"]', nodes => nodes.every(node => node.disabled)), 'Bypass disables numeric controls');
    await page.click('[aria-label="Enable ' + name + '"]'); await page.click('[aria-label="Reset ' + name + '"]'); await flush();
    assert.equal(await page.evaluate(key => window.timeline.clips[0][key].enabled, key), true, 'Reset retains enabled state');
    assert.equal(await page.evaluate(key => window.timeline.clips[0][key].amount, key), key === 'vhs' ? .65 : .55);
    await page.screenshot({ path: '/tmp/revline-' + key + '-controls.png' });
    await page.click('[aria-label="Remove ' + name + '"]'); await flush();
    assert.equal(await page.evaluate(key => window.timeline.clips[0][key], key), undefined);
    // Removing an applied effect keeps the clip's settings open instead of jumping to the library (10be298).
    assert.ok(await page.$('#inspector-effects .inspector-clip-settings'), 'Removal stays in Clip settings');
    assert.equal(await page.$('.effect-library'), null, 'Removal does not jump to the library');
    assert.equal(await page.$(controls(key)), null, 'Removed effect controls disappear');
    await page.evaluate(() => window.tools()); await flush();
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Texture controls fit 320px');
  assert.deepEqual(errors, []);
  console.log('PASS: production Texture catalog applies both effects, editable slider/color controls commit, bypass/reset preserve settings, removal stays in Clip settings, 320px layout.');
} finally { await browser.close(); }
