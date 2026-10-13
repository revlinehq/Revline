import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// Render only synthetic controls, with no app server, project, credentials or media jobs.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {EffectLibrary} from './components/editor/effect-library';
import {TextEffectsControls} from './components/editor/text-effects-controls';
import './components/workspace/workspace-pages.css';import './app/editor.css';
function Fixture(){const[mode,setMode]=useState('library'),[clip,setClip]=useState({id:'words',kind:'graphic',text:'My actual words',duration:3,start:0,sourceStart:0,track:1});
window.fixture={clip};const change=patch=>{window.commits++;setClip(previous=>({...previous,...patch}))};
return <><button id="switch" onClick={()=>setMode(mode==='library'?'controls':'library')}>Switch fixture</button>{mode==='library'?<EffectLibrary clip={clip} assets={[]} onMedia={()=>{}} onVisualEffect={()=>{}} onUploadOverlay={()=>{}} onTextTemplate={preset=>change({textTemplate:{preset}})}/>:<TextEffectsControls clip={clip} onChange={change}/>}</>}
window.commits=0;createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-text-picker-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const labels = ['Word reveal', 'Pop-in words', 'Sliding title', 'Karaoke', 'Neon echo', 'Lyric slam', 'Kinetic stack'];
const selector = label => `.text-preset-card[aria-label="${label}"]`;
const frame = label => page.$eval(`${selector(label)} [data-frame]`, element => Number(element.dataset.frame));
try {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.setViewport({ width: 360, height: 960 });
  await page.setContent('<html data-workspace-theme="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:var(--ws-bg);margin:0}#root{width:280px;margin:20px auto}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  assert.equal(await page.$('.text-preset-picker'), null, 'Effects do not mount the text renderer');
  assert.equal(await page.$$eval('.library-look', rows => rows.every(row => row.getBoundingClientRect().height <= 34)), true, 'VFX stay compact');
  await page.click('[data-library-tab="text"]'); await page.waitForSelector('.text-preset-card');
  assert.deepEqual(await page.$$eval('.text-preset-card', cards => cards.map(card => card.getAttribute('aria-label'))), labels);
  assert.equal(await page.$$eval('.text-preset-stage', stages => stages.every(stage => stage.getBoundingClientRect().height === 72)), true);
  assert.ok(await page.$eval('.text-preset-picker', element => element.scrollWidth <= element.clientWidth));
  for (const label of labels) {
    assert.equal(await frame(label), 45, 'Idle card shows its hold frame');
    await page.hover(selector(label));
    await page.waitForFunction(selector => Number(document.querySelector(selector+' [data-frame]').dataset.frame) > 1 && Number(document.querySelector(selector+' [data-frame]').dataset.frame) < 44, {}, selector(label));
    await page.mouse.move(0, 0);
    await page.waitForFunction(selector => document.querySelector(selector+' [data-frame]').dataset.frame === '45', {}, selector(label));
  }
  assert.equal(await page.evaluate(() => window.commits), 0, 'Previewing never applies a preset');
  await page.focus(selector('Lyric slam'));
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Lyric slam"] [data-frame]').dataset.frame) < 44);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.commits), 1, 'Keyboard applies once');
  assert.equal(await page.evaluate(() => window.fixture.clip.textTemplate.preset), 'lyric-slam');
  await page.evaluate(() => document.activeElement.blur());
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.hover(selector('Neon echo')); await page.focus(selector('Neon echo'));
  await page.waitForFunction(() => document.querySelector('[aria-label="Neon echo"] [data-frame]').dataset.frame === '45');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(await frame('Neon echo'), 45, 'Reduced motion stays static on hover and focus');
  await page.click(selector('Neon echo'));
  assert.equal(await page.evaluate(() => window.commits), 2, 'Pointer applies once');
  await page.mouse.move(0, 0);await page.evaluate(() => document.activeElement.blur());
  await page.screenshot({ path: '/tmp/revline-text-preset-previews-dark.png' });
  await page.click('#switch'); await page.waitForSelector('[aria-label="Selected text"]');
  assert.equal(await page.$eval('[aria-label="Selected text"]', element => element.value), 'My actual words');
  await page.focus('[aria-label="Selected text"]'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.type('[aria-label="Selected text"]', 'Changed words');
  assert.equal(await page.evaluate(() => window.fixture.clip.text), 'Changed words', 'Actual text remains editable');
  assert.deepEqual(await page.$$eval('.text-preset-card', cards => cards.map(card => card.getAttribute('aria-label'))), labels, 'Both surfaces share the picker');
  assert.equal(await page.$eval(selector('Neon echo'), element => element.getAttribute('aria-pressed')), 'true');
  assert.ok(await page.$('[aria-label="Custom text size"]'), 'Custom text size remains');
  assert.equal(await page.$('[aria-label="Text rotation"]'), null, 'Rotation numeric control is removed');
  await page.evaluate(() => { document.documentElement.dataset.workspaceTheme = 'light'; });
  await page.screenshot({ path: '/tmp/revline-text-preset-previews-light.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: seven real Remotion previews, static idle, hover/focus motion and cleanup, reduced motion, single apply, compact VFX, shared selection and editable words/rotation. Synthetic fixture only.');
} finally { await browser.close(); }
