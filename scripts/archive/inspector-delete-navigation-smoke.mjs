import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { startFixtureFontServer } from './ui-fixture-fonts.mjs';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {PreviewInspector} from './components/editor/preview-inspector';
import {addEffectClip,deleteClip,patchClip} from './lib/editor/operations';
import './components/workspace/workspace-pages.css';import './app/editor.css';
const footage={id:'footage',kind:'image',assetId:'source',track:1,start:0,duration:5,sourceStart:0};
const initial=addEffectClip({fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[footage]},'effect','quick-zoom-in',1);
const asset={_id:'source',kind:'image',fileName:'Synthetic image',width:640,height:360,url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#387d8c"/></svg>')};
function Fixture(){const[timeline,setTimeline]=useState(initial),[selected,setSelected]=useState('effect'),[editRequest,setEditRequest]=useState(1);const clip=timeline.clips.find(item=>item.id===selected);
window.fixture={timeline,select:id=>{setSelected(id);setEditRequest(value=>value+1)},clear:()=>setSelected(null),remove:()=>setTimeline(previous=>deleteClip(previous,selected)),restore:()=>setTimeline(initial),removeApplied:key=>setTimeline(previous=>patchClip(previous,selected,{[key]:undefined}))};
return <PreviewInspector clip={clip} timeline={timeline} assets={[asset]} asset={clip?.assetId===asset._id?asset:undefined} upload={null} editRequest={editRequest} onUpload={()=>{}} onAdd={()=>{}} onCrop={()=>{}} onChange={patch=>setTimeline(previous=>patchClip(previous,selected,patch))} onAddEffect={()=>{}}/>}
createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-inspector-delete-navigation', define: { 'process.env.NODE_ENV': '"production"' } });

const fonts = await startFixtureFontServer();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.setViewport({ width: 520, height: 800 });
  await page.goto(fonts.url);
  await page.setContent('<html data-workspace-theme="dark"><body><div id="root" class="conversation-editor"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font:12px Arial}button{border:0;font-family:inherit}#root{width:480px;height:760px;margin:20px auto}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const assertTools = async reason => {
    await flush();
    assert.ok(await page.$('.effect-library'), reason);
    assert.equal(await page.$('.inspector-empty'), null, 'Tools never leaves a selection placeholder after deletion');
    assert.equal(await page.$('.inspector-tabs'), null, 'Stale Edit / Effects tabs are absent');
    assert.equal(await page.$eval('#inspector-tools-tab', node => node.getAttribute('aria-selected')), 'true');
  };

  // Removing an applied effect keeps its clip selected, so the inspector stays in Clip settings (10be298).
  const assertClipSettings = async reason => {
    await flush();
    assert.ok(await page.$('#inspector-effects .inspector-clip-settings'), reason);
    assert.equal(await page.$('.effect-library'), null, 'Removing an applied effect does not jump to the library');
    assert.equal(await page.$('.inspector-empty'), null, 'Clip settings never show a selection placeholder after removal');
    assert.equal(await page.$('[aria-label="Remove Invert colors"]'), null, 'The removed effect is no longer listed');
  };

  await page.waitForSelector('[aria-label="Effect settings"]');
  await page.evaluate(() => window.fixture.remove());
  await assertTools('Deleting the selected timed effect returns to the Tools library');

  await page.evaluate(() => { window.fixture.restore(); window.fixture.select('effect'); });
  await page.waitForSelector('[aria-label="Effect settings"]');
  assert.equal(await page.$('.effect-library'), null, 'Selecting an effect still opens its controls');
  await page.evaluate(() => window.fixture.select('footage'));
  await page.waitForSelector('.inspector-clip-settings');
  assert.equal(await page.$('.effect-library'), null, 'Switching directly to footage keeps clip settings');
  await page.evaluate(() => window.fixture.clear());
  await assertTools('Clearing selection also leaves Tools ready to use');

  await page.evaluate(() => window.fixture.select('footage'));
  await page.waitForSelector('.inspector-clip-settings');
  await page.click('[aria-label="Add effect"]');
  await page.waitForSelector('.effect-library');
  await page.click('[data-category="color"]');
  await page.click('[aria-label="Invert colors"]');
  await page.waitForSelector('[aria-label="Remove Invert colors"]');
  await page.click('[aria-label="Remove Invert colors"]');
  await assertClipSettings('Removing the selected applied effect stays in its Clip settings');
  assert.equal(await page.evaluate(() => window.fixture.timeline.clips.find(clip => clip.id === 'footage').invert), undefined);

  await page.click('[aria-label="Add effect"]');
  await page.waitForSelector('.effect-library');
  await page.click('[data-category="color"]');
  await page.click('[aria-label="Invert colors"]');
  await page.waitForSelector('[aria-label="Remove Invert colors"]');
  await page.evaluate(() => window.fixture.removeApplied('invert'));
  await assertClipSettings('External removal of the selected applied effect also stays in Clip settings');

  await page.evaluate(() => { window.fixture.restore(); window.fixture.select('effect'); });
  await page.waitForSelector('[aria-label="Effect settings"]');
  await page.click('#inspector-media-tab');
  await page.waitForSelector('#inspector-media');
  await page.evaluate(() => window.fixture.remove());
  await flush();
  assert.equal(await page.$eval('#inspector-media-tab', node => node.getAttribute('aria-selected')), 'true', 'Deleting a clip preserves an explicit My media choice');
  assert.ok(await page.$('#inspector-media'));
  await page.click('#inspector-tools-tab');
  await assertTools('Returning from My media after deletion opens Tools');

  await page.evaluate(() => { window.fixture.restore(); window.fixture.select('footage'); });
  await page.waitForSelector('.inspector-clip-settings');
  await page.click('[aria-label="Add effect"]');
  await page.click('[data-category="color"]');
  await page.click('[aria-label="Invert colors"]');
  await page.waitForSelector('[aria-label="Remove Invert colors"]');
  await page.evaluate(() => window.fixture.select('effect'));
  await page.waitForSelector('[aria-label="Effect settings"]');
  assert.equal(await page.$('.effect-library'), null, 'Changing clips from an applied-effect detail opens the next selected clip settings');
  assert.deepEqual(errors, []);
  console.log('PASS: timed effect deletion returns to Tools; applied effect removal (direct and external) stays in Clip settings; cleared selection, direct clip changes, reselection, external removal, and My media remain correct.');
} finally {
  await browser.close();
  await fonts.close();
}
