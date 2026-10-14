import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { startFixtureFontServer } from './ui-fixture-fonts.mjs';

// Owned silent audio lets us exercise playback without fetching user media.
const wav = Buffer.alloc(44 + 16000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(16000, 40);
const soundUrl = `data:audio/wav;base64,${wav.toString('base64')}`;
async function bundle(mode) {
  return build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {PreviewInspector} from './components/editor/preview-inspector';
import './components/workspace/workspace-pages.css';import './app/editor.css';
const assets=[{_id:'hit',fileName:'Impact.wav',kind:'audio',url:${JSON.stringify(soundUrl)},duration:1},{_id:'missing',fileName:'Missing.wav',kind:'audio',url:null},{_id:'video',fileName:'Footage.mp4',kind:'video',url:null},{_id:'broken',fileName:'Broken.wav',kind:'audio',url:'data:audio/wav;base64,aW52YWxpZA=='}];
window.added=[];window.uploads=0;
createRoot(document.getElementById('root')).render(<PreviewInspector assets={assets} upload={null} onUpload={()=>window.uploads++} onAdd={asset=>window.added.push(asset._id)} onChange={()=>{}} onCrop={()=>{}}/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-sfx-smoke', define: { 'process.env.NODE_ENV': JSON.stringify(mode) } });
}
const fonts = await startFixtureFontServer();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const mode of ['production', 'development']) {
    const result = await bundle(mode);
    const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
    if (mode === 'production') assert.ok(!js.includes('Could not preview this sound'), 'Production omits the dev sound player');
    const page = await browser.newPage(); page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 360, height: 640 }); await page.goto(fonts.url);
    await page.setContent('<html data-workspace-theme="dark"><body><div id="root" class="conversation-editor"></div></body></html>');
    await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text });
    await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font:12px Arial}#root{width:360px;height:640px}' });
    await page.addScriptTag({ content: js }); await page.waitForSelector('.library-category-rail');
    if (mode === 'production') {
      assert.equal(await page.$('[data-category="sfx-dev"]'), null);
      assert.equal(await page.$('[data-category="sam-dev"]'), null);
    } else {
      assert.deepEqual((await page.$$eval('.library-category-rail [role="tab"]', nodes => nodes.map(node => node.textContent))).slice(-2), ['SAM 3 (dev)', 'SFX (dev)']);
      const searchTop = await page.$eval('.library-search', node => node.getBoundingClientRect().top);
      await page.focus('[data-category="motion"]'); await page.keyboard.press('End');
      await page.waitForSelector('.library-sfx');
      assert.ok(await page.$('[data-category="sfx-dev"][aria-selected="true"]'), 'SFX participates in keyboard navigation');
      assert.equal(await page.$$eval('.library-sfx-row', nodes => nodes.length), 3, 'Only audio appears');
      assert.equal(await page.$eval('.library-search', node => node.getBoundingClientRect().top), searchTop);
      assert.equal(await page.$eval('[aria-label="Preview Missing.wav"]', node => node.disabled), true);
      assert.equal(await page.$eval('[aria-label="Add Missing.wav at playhead"]', node => node.disabled), true);
      assert.equal(await page.$('audio'), null, 'No audio downloads until preview is requested');
      await page.click('[aria-label="Preview Impact.wav"]');
      await page.waitForFunction(() => document.querySelector('audio')?.paused === false);
      assert.deepEqual(await page.evaluate(() => window.added), [], 'Preview never adds a clip');
      await page.evaluate(() => { window.previewPlayer = document.querySelector('audio'); });
      await page.click('[data-category="motion"]');
      assert.ok(await page.evaluate(() => window.previewPlayer.paused), 'Changing category stops preview');
      await page.click('[data-category="sfx-dev"]'); await page.waitForSelector('.library-sfx');
      await page.type('[aria-label="Search effects"]', 'impact');
      assert.equal(await page.$$eval('.library-sfx-row', nodes => nodes.length), 1);
      await page.click('[aria-label="Add Impact.wav at playhead"]');
      assert.deepEqual(await page.evaluate(() => window.added), ['hit'], 'Uses the inspector’s existing asset insertion');
      await page.click('.library-sfx-upload'); assert.equal(await page.evaluate(() => window.uploads), 1);
      await page.type('[aria-label="Search effects"]', ' no match');
      assert.equal(await page.$eval('.library-empty', node => node.textContent), 'No matching sounds.');
      assert.equal(await page.$('.library-look-grid .library-look'), null, 'Sound search never falls through to visual effects');
      await page.click('[data-category="motion"]'); await page.click('[data-category="sfx-dev"]');
      await page.waitForSelector('[aria-label="Preview Broken.wav"]'); await page.click('[aria-label="Preview Broken.wav"]');
      await page.waitForSelector('.library-sfx [role="alert"]'); assert.equal(await page.$('audio'), null, 'Failed preview resets playback');
      await page.click('[aria-label="Preview Impact.wav"]');
      await page.waitForSelector('[aria-label="Stop Impact.wav"]');
      await page.waitForSelector('[aria-label="Preview Impact.wav"]', { timeout: 8000 });
      assert.equal(await page.$('audio'), null, 'Ended preview resets playback');
      await page.setViewport({ width: 320, height: 640 }); await page.addStyleTag({ content: '#root{width:320px}' });
      assert.ok(await page.$eval('.preview-inspector', node => node.scrollWidth <= node.clientWidth), 'Fits at 320px');
      await page.screenshot({ path: '/tmp/revline-sfx-dark.png' });
      await page.evaluate(() => document.documentElement.dataset.workspaceTheme = 'light');
      await page.screenshot({ path: '/tmp/revline-sfx-light.png' });
    }
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('PASS: dev-only SFX below SAM; production excludes player; audio-only search, preview lifecycle/error handling, upload/add wiring, fixed search and 320px layout.');
} finally { await browser.close(); await fonts.close(); }
