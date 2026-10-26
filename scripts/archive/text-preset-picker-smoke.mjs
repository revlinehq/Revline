import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { startFixtureFontServer } from './ui-fixture-fonts.mjs';

// Actual library/settings/renderers; no app backend, media jobs or paid APIs.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{EffectLibrary}from'./components/editor/effect-library';import{TextEffectsControls}from'./components/editor/text-effects-controls';
import'./components/workspace/workspace-pages.css';import'./app/editor.css';
function Fixture(){const[mode,setMode]=useState('library'),[clip,setClip]=useState({id:'words',kind:'graphic',text:'My actual words',duration:3,start:0,sourceStart:0,track:1});window.fixture={clip};return <><button id="switch" onClick={()=>setMode(mode==='library'?'controls':'library')}>Switch fixture</button><div className="preview-inspector">{mode==='library'?<EffectLibrary clip={clip} assets={[]} onVisualEffect={()=>{}}/>:<TextEffectsControls clip={clip} onChange={patch=>{window.commits++;setClip(previous=>({...previous,...patch}))}}/>}</div></>};window.commits=0;createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-text-picker-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const fonts = await startFixtureFontServer();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const labels = ['None', 'Fade', 'Rise', 'Pop in', 'Word reveal', 'Pop-in words', 'Sliding title', 'Karaoke', 'Neon echo', 'Lyric slam', 'Kinetic stack', 'Chromatic split', 'Outline trails', 'Cinematic focus', 'Character scramble', 'Spotlight sweep', 'Ink write-on', 'Echo tunnel'];
const selector = label => `.text-animation-card[aria-label="${label}"]`;
const frame = label => page.$eval(`${selector(label)} [data-frame]`, node => Number(node.dataset.frame));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.setViewport({ width: 360, height: 960, hasTouch: true });
  await page.goto(fonts.url); await page.setContent('<html data-workspace-theme="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;font:12px Arial;background:var(--ws-bg)}#root{width:280px;margin:20px auto}.preview-inspector{height:820px}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.waitForSelector('.effect-library'); assert.equal(await page.$('.text-preset-picker'), null, 'Footage tools do not mount the text renderer');
  await page.click('[data-category="text"]'); await page.waitForSelector('[aria-label="Default text"]'); assert.equal(await page.$('[aria-label="Text animations"]'), null, 'Library offers text looks, not standalone animation entities');
  await page.click('#switch'); await page.waitForSelector('[aria-label="Selected text"]'); await page.click('#text-settings-animation-tab'); await page.waitForSelector(selector('Echo tunnel'));
  assert.deepEqual(await page.$$eval('.text-animation-card', nodes => nodes.map(node => node.getAttribute('aria-label'))), labels);
  assert.ok(await page.$eval('.preview-inspector', node => node.scrollWidth <= node.clientWidth), 'Settings fit the narrow pane');
  const fade = await frame('Fade'); await wait(220); assert.notEqual(await frame('Fade'), fade, 'Visible previews animate without hover, focus or click');
  assert.equal(await frame('Echo tunnel'), 45, 'Offscreen cards stay at their hold frame');
  await page.$eval(selector('Echo tunnel'), node => node.scrollIntoView({ block: 'center' })); await page.waitForFunction(selector => document.querySelector(selector + ' [data-frame]').dataset.frame !== '45', {}, selector('Echo tunnel'));
  await page.$eval('.text-settings-view', node => node.scrollTop = 0); await page.waitForFunction(selector => document.querySelector(selector + ' [data-frame]').dataset.frame === '45', {}, selector('Echo tunnel'));
  assert.equal(await page.evaluate(() => window.commits), 0, 'Automatic previews never apply an animation');

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.waitForFunction(() => document.querySelector('[aria-label="Fade"] [data-frame]').dataset.frame === '45');
  await wait(220); assert.equal(await frame('Fade'), 45, 'Reduce Motion stops automatic previews');
  await page.focus('[aria-label="Preview Fade"]'); await page.hover(selector('Fade')); await wait(160); assert.equal(await frame('Fade'), 45, 'Hover/focus respect Reduce Motion');
  await page.click('[aria-label="Preview Word reveal"]'); await page.waitForFunction(() => { const frame = Number(document.querySelector('[aria-label="Word reveal"] [data-frame]').dataset.frame); return frame > 1 && frame < 20; });
  const words = () => page.$$eval('[aria-label="Word reveal"] [data-word-index]', nodes => nodes.map(node => ({ opacity: getComputedStyle(node).opacity, transform: getComputedStyle(node).transform })));
  const early = await words(); await page.waitForFunction(() => Number(document.querySelector('[aria-label="Word reveal"] [data-frame]').dataset.frame) > 35); assert.notDeepEqual(await words(), early, 'Explicit preview still changes real rendered word properties');
  assert.equal(await page.evaluate(() => window.commits), 0, 'Explicit preview does not apply');
  await page.focus('[aria-label="Apply Word reveal"]'); await page.keyboard.press('Enter'); await flush();
  assert.equal(await page.evaluate(() => window.commits), 1); assert.equal(await page.evaluate(() => window.fixture.clip.textTemplate.preset), 'word-reveal');
  assert.equal(await page.$eval('[aria-label="Apply Word reveal"]', node => node.getAttribute('aria-pressed')), 'true');
  await page.click('#text-settings-text-tab'); await page.waitForSelector('[aria-label="Selected text"]');
  assert.equal(await page.$('.text-animation-card'), null, 'Leaving Animation unmounts its preview clocks');
  assert.equal(await page.$eval('[aria-label="Selected text"]', node => node.value), 'My actual words');
  await page.focus('[aria-label="Selected text"]'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('Changed words');
  assert.equal(await page.evaluate(() => window.fixture.clip.text), 'Changed words');
  assert.deepEqual(errors, []);
  console.log('PASS: all 18 real text animation cards, narrow layout, visible autoplay without interaction, offscreen cleanup, Reduce Motion stays still on hover/focus, explicit rendered preview remains available, keyboard apply once, editable words and tab unmount. Synthetic fixture only.');
} finally { await browser.close(); await fonts.close(); }
