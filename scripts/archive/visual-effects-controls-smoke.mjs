import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundled = await build({ stdin: { contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {PreviewInspector} from './components/editor/preview-inspector';
import {setClipPlaybackRate} from './lib/editor/operations';
import './components/workspace/workspace-pages.css';import './app/editor.css';
function Fixture(){const [clip,setClip]=useState({id:'video',kind:'video',start:0,sourceStart:0,duration:4});window.fixtureClip=clip;window.selectClip=setClip;return <PreviewInspector clip={clip} assets={[]} upload={null} onUpload={()=>{}} onAdd={()=>{}} onCrop={()=>{}} onClose={()=>{}} onChange={patch=>{window.commits.push(patch);setClip(previous=>({...previous,...patch}));}} onPreviewEffects={patch=>window.previews.push(patch)} onPlaybackRateChange={rate=>setClip(previous=>setClipPlaybackRate({fps:30,aspectRatio:'vertical',tracks:{visual:1,overlay:0,audio:1},clips:[previous]},previous.id,rate).clips[0])} onAddEffect={preset=>window.addedPresets.push(preset)}/>;}
window.commits=[];window.previews=[];window.addedPresets=[];window.resetCounters=()=>{window.commits=[];window.previews=[];};createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', write: false, outdir: '/tmp/revline-visual-controls-smoke', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const input = label => `input[aria-label="${label}"]`;
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const counts = () => page.evaluate(() => ({ commits: window.commits.length, previews: window.previews.length }));
const libraryButton = name => page.locator(`::-p-aria([name="${name}"][role="button"])`);
// Applied effects are added from the Tools library, open on their own page, then stay expanded inline in Clip settings (c55d5b2, 10be298).
const add = async (category, name) => { await page.click('[aria-label="Add effect"]'); await page.waitForSelector('.effect-library'); await page.click(`[data-category="${category}"]`); await libraryButton(name).click(); await page.waitForSelector('.inspector-effect-detail'); await page.click('[aria-label="Back to clip settings"]'); await page.waitForSelector('#inspector-effects .inspector-clip-settings'); await flush(); };
// Playback speed is a shared slider inside the collapsed Playback disclosure (f6a061d).
const speedKey = async key => { await page.$$eval('details.footage-playback', nodes => nodes.forEach(node => { node.open = true; })); await page.focus(input('Playback speed')); await page.keyboard.press(key); await flush(); };
try {
  await page.setViewport({ width: 600, height: 820 });
  await page.setContent('<div id="root" class="conversation-editor"></div>');
  await page.addStyleTag({ content: bundled.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font-family:Arial,sans-serif}#root{width:320px;height:800px;margin:10px auto}button{border:0;font-family:inherit}.visual-effects-menu [role=menuitem]{display:flex;align-items:center;padding:6px}.visual-effects-menu{padding:4px;border:1px solid var(--ws-artifact-border);border-radius:6px}' });
  await page.addScriptTag({ content: bundled.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.waitForSelector('.effect-library');
  // Timed presets come from the Motion library; Zoom folds In/Out/Punch into one entry (17ce5f6) and, unlike bars/blur, opens Clip settings.
  await page.click('[data-category="motion"]');
  for (const label of ['Cinema bars', 'Zoom blur', 'Zoom']) await libraryButton(label).click();
  assert.deepEqual(await page.evaluate(() => window.addedPresets), ['cinematic-bars', 'zoom-blur', 'quick-zoom-in']);
  await page.waitForSelector('#inspector-effects .inspector-clip-settings');
  assert.equal(await page.$('#inspector-effects-tab'), null, 'Footage opens one Clip settings view without Edit / Effects tabs');
  await speedKey('End');
  assert.deepEqual(await page.evaluate(() => [window.fixtureClip.playbackRate, window.fixtureClip.duration]), [4, 1]);
  await speedKey('Home');
  assert.deepEqual(await page.evaluate(() => [window.fixtureClip.playbackRate, window.fixtureClip.duration]), [.25, 16]);
  await add('color', 'Color & light');
  assert.equal(await page.evaluate(() => window.fixtureClip.colorGrade.enabled), true);
  await page.evaluate(() => window.resetCounters());
  const exposure = await page.$eval(input('Exposure'), el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await page.mouse.move(exposure.x + exposure.width * .55, exposure.y + exposure.height / 2); await page.mouse.down();
  await page.mouse.move(exposure.x + exposure.width * .8, exposure.y + exposure.height / 2, { steps: 8 }); await flush();
  assert.equal((await counts()).commits, 0, 'Dragging previews without saving');
  assert.ok((await counts()).previews > 0, 'Dragging sends live preview patches');
  await page.mouse.up(); await flush();
  assert.equal((await counts()).commits, 1, 'A pointer gesture saves once');
  assert.ok(await page.evaluate(() => window.fixtureClip.colorGrade.exposure > 1));
  await page.evaluate(() => window.resetCounters()); await page.focus(input('Exposure'));
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('ArrowLeft'); await page.keyboard.down('ArrowLeft'); await flush();
  assert.equal((await counts()).commits, 0, 'A repeated keyboard gesture previews until keyup');
  await page.keyboard.up('ArrowLeft'); await flush(); assert.equal((await counts()).commits, 1);
  const saved = await page.evaluate(() => window.fixtureClip.colorGrade.exposure);
  await page.evaluate(() => window.resetCounters());
  await page.mouse.move(exposure.x + exposure.width * .2, exposure.y + exposure.height / 2); await page.mouse.down();
  await page.mouse.move(exposure.x + exposure.width * .3, exposure.y + exposure.height / 2); await flush();
  await page.keyboard.press('Escape'); await page.mouse.up(); await flush();
  assert.equal((await counts()).commits, 0, 'Escape cancels instead of saving');
  assert.equal(await page.evaluate(() => window.previews.at(-1)), null);
  assert.equal(await page.$eval(input('Exposure'), el => Number(el.value)), saved);
  await page.click('[aria-label="Enable Color"]'); await flush();
  assert.equal(await page.$eval(input('Exposure'), el => el.disabled), true);
  assert.equal(await page.evaluate(() => window.fixtureClip.colorGrade.exposure), saved, 'Disable preserves values');
  await page.click('[aria-label="Enable Color"]'); await page.click('[aria-label="Reset Color"]'); await flush();
  assert.equal(await page.evaluate(() => window.fixtureClip.colorGrade.exposure), 0);
  await page.click('[data-effect="colorGrade"] .effect-collapse');
  assert.equal(await page.$eval('[data-effect="colorGrade"] .visual-effect-fields', el => el.hidden), true);
  await page.click('[data-effect="colorGrade"] .effect-collapse');
  await add('texture', 'Digital glitch'); await add('color', 'Invert colors'); await add('texture', 'Dither');
  assert.equal(await page.$$eval('.visual-effect-card', cards => cards.length), 4);
  assert.equal(await page.$$eval('.visual-effect-fields:not([hidden])', fields => fields.length), 1, 'Only the newest applied effect is expanded');
  assert.ok(await page.$eval('.preview-inspector', el => el.scrollWidth <= el.clientWidth), 'Cards fit a 320px inspector');
  await page.$eval('.inspector-content', el => { el.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/revline-visual-effects-light.png' });
  await page.evaluate(() => { document.documentElement.dataset.workspaceTheme = 'dark'; });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  assert.equal(await page.$eval('.visual-effects-controls', el => getComputedStyle(el).animationName), 'none');
  await page.screenshot({ path: '/tmp/revline-visual-effects-dark.png' });
  await page.click('[aria-label="Remove Glitch"]'); await flush();
  assert.equal(await page.evaluate(() => window.fixtureClip.glitch), undefined);
  assert.equal(await page.$('[data-effect="glitch"]'), null);
  await page.evaluate(() => window.selectClip({ id: 'title', kind: 'graphic', text: 'Text', start: 0, sourceStart: 0, duration: 4 })); await flush();
  // Text clips keep text settings and animations in their own Edit view (7620721, aef76cd).
  assert.equal(await page.$('#inspector-effects-tab'), null, 'Text has no visual Effects tab');
  await page.click('#text-settings-animation-tab'); await page.waitForSelector('[aria-label="Text animations"]');
  assert.equal(await page.$('.visual-effects-controls'), null);
  await page.evaluate(() => window.selectClip({ id: 'sound', kind: 'audio', start: 0, sourceStart: 0, duration: 4 })); await flush();
  if (await page.$('#inspector-effects-tab')) await page.click('#inspector-effects-tab');
  await page.waitForSelector(input('Playback speed'));
  assert.equal(await page.$('.visual-effect-card'), null);
  await speedKey('End');
  assert.deepEqual(await page.evaluate(() => [window.fixtureClip.playbackRate, window.fixtureClip.duration]), [4, 1]);
  console.log('PASS: Clip settings support library timed zoom/bars/zoom-blur presets, video/audio speed, all four visual effect groups, live drag + one save, keyboard, cancel, enable, reset, collapse, removal, light/dark, reduced motion, and text effects.');
} finally { await browser.close(); }
