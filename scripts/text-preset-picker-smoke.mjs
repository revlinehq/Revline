import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import {startFixtureFontServer} from './ui-fixture-fonts.mjs';

// Render only synthetic controls, with no app server, project, credentials or media jobs.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {EffectLibrary} from './components/editor/effect-library';
import {TextEffectsControls} from './components/editor/text-effects-controls';
import {textAnimationPatch} from './lib/editor/text-effects';
import './components/workspace/workspace-pages.css';import './app/editor.css';
function Fixture(){const[mode,setMode]=useState('library'),[clip,setClip]=useState({id:'words',kind:'graphic',text:'My actual words',duration:3,start:0,sourceStart:0,track:1});
window.fixture={clip};const change=patch=>{window.commits++;setClip(previous=>({...previous,...patch}))};
return <><button id="switch" onClick={()=>setMode(mode==='library'?'controls':'library')}>Switch fixture</button>{mode==='library'?<EffectLibrary clip={clip} assets={[]} onMedia={()=>{}} onVisualEffect={()=>{}} onUploadOverlay={()=>{}} onTextAnimation={preset=>change(textAnimationPatch(clip,preset))}/>:<TextEffectsControls clip={clip} onChange={change}/>}</>}
window.commits=0;createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-text-picker-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const fonts=await startFixtureFontServer();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const labels = ['None', 'Fade', 'Rise', 'Pop in', 'Word reveal', 'Pop-in words', 'Sliding title', 'Karaoke', 'Neon echo', 'Lyric slam', 'Kinetic stack'];
const selector = label => `.text-preset-card:not(.text-look-card)[aria-label="${label}"]`;
const frame = label => page.$eval(`${selector(label)} [data-frame]`, element => Number(element.dataset.frame));
try {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.setViewport({ width: 360, height: 960, hasTouch: true });
  await page.goto(fonts.url);
  await page.setContent('<html data-workspace-theme="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:var(--ws-bg);margin:0}#root{width:280px;margin:20px auto}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  assert.equal(await page.$('.text-preset-picker'), null, 'Effects do not mount the text renderer');
  assert.equal(await page.$$eval('.library-look', rows => rows.every(row => row.getBoundingClientRect().height <= 34)), true, 'VFX stay compact');
  await page.click('[data-segment="text"]'); await page.waitForSelector('[aria-label="Word reveal"]');
  assert.deepEqual(await page.$$eval('.text-preset-card:not(.text-look-card)', cards => cards.map(card => card.getAttribute('aria-label'))), labels);
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
  await page.tap('[aria-label="Preview Word reveal"]');
  await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Word reveal"] [data-frame]').dataset.frame)<44);
  const earlyWords=await page.$$eval('[aria-label="Word reveal"] [data-word-index]',nodes=>nodes.map(node=>({opacity:getComputedStyle(node).opacity,transform:getComputedStyle(node).transform})));await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Word reveal"] [data-frame]').dataset.frame)>35);const lateWords=await page.$$eval('[aria-label="Word reveal"] [data-word-index]',nodes=>nodes.map(node=>({opacity:getComputedStyle(node).opacity,transform:getComputedStyle(node).transform})));assert.notDeepEqual(earlyWords,lateWords,'Touch preview changes the actual rendered word opacity and position');
  assert.equal(await page.evaluate(()=>window.commits),0,'Tapping an animation stage previews without applying');
  assert.equal(await page.$eval('[aria-label="Word reveal"]',node=>node.textContent.includes('My actual words')),true,'The preview uses selected clip words');
  await page.focus('[aria-label="Preview Lyric slam"]');
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Lyric slam"] [data-frame]').dataset.frame) < 44);
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.commits),0,'Keyboard preview does not apply');await page.focus('[aria-label="Apply Lyric slam"]');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.commits), 1, 'Keyboard applies once');
  assert.equal(await page.evaluate(() => window.fixture.clip.textTemplate.preset), 'lyric-slam');
  await page.evaluate(() => document.activeElement.blur());
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.hover(selector('Neon echo')); await page.focus('[aria-label="Preview Neon echo"]');
  await page.waitForFunction(() => document.querySelector('[aria-label="Neon echo"] [data-frame]').dataset.frame === '45');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(await frame('Neon echo'), 45, 'Reduced motion stays static on hover and focus');
  await page.click('[aria-label="Preview Neon echo"]');assert.equal(await page.evaluate(()=>window.commits),1,'Reduced-motion preview does not apply');await page.click('[aria-label="Apply Neon echo"]');
  assert.equal(await page.evaluate(() => window.commits), 2, 'Pointer applies once');
  await page.mouse.move(0, 0);await page.evaluate(() => document.activeElement.blur());
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({ path: '/tmp/revline-text-preset-previews-dark.png' });
  await page.click('#switch'); await page.waitForSelector('[aria-label="Selected text"]');
  assert.equal(await page.$eval('[aria-label="Selected text"]', element => element.value), 'My actual words');
  await page.focus('[aria-label="Selected text"]'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.type('[aria-label="Selected text"]', 'Changed words');
  assert.equal(await page.evaluate(() => window.fixture.clip.text), 'Changed words', 'Actual text remains editable');
  assert.deepEqual(await page.$$eval('.text-preset-card:not(.text-look-card)', cards => cards.map(card => card.getAttribute('aria-label'))), labels, 'Both surfaces share the picker');
  assert.equal(await page.$eval('[aria-label="Apply Neon echo"]', element => element.getAttribute('aria-pressed')), 'true');
  assert.ok(await page.$('[aria-label="Custom text size"]'), 'Custom text size remains');
  assert.equal(await page.$('[aria-label="Text rotation"]'), null, 'Rotation numeric control is removed');
  await page.evaluate(() => { document.documentElement.dataset.workspaceTheme = 'light'; });
  await page.screenshot({ path: '/tmp/revline-text-preset-previews-light.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: eleven real text-runtime animation previews, static idle, hover/focus motion and cleanup, reduced motion, single apply, compact VFX, touch preview-only rendered motion, explicit Apply, shared selection and editable words/rotation. Synthetic fixture only.');
} finally { await browser.close();await fonts.close(); }
