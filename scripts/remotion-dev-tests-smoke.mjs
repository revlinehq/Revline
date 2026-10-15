import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { startFixtureFontServer } from './ui-fixture-fonts.mjs';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{RemotionDevTests}from'./components/dev/remotion-dev-tests';
import'./components/workspace/shared.css';import'./components/workspace/workspace-pages.css';
function Fixture(){const[embedded,setEmbedded]=useState(false),[query,setQuery]=useState('');window.labFixture={setEmbedded,setQuery};return <div style={{width:embedded?320:'100%',margin:'auto'}}><RemotionDevTests embedded={embedded} query={query}/></div>}
createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-remotion-dev-smoke', define: { 'process.env.NODE_ENV': '"production"' } });

await mkdir('/tmp/revline-remotion-lab', { recursive: true });
const fonts = await startFixtureFontServer();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  page.setDefaultTimeout(8000);
  await page.setViewport({ width: 1380, height: 1050 });
  await page.goto(fonts.url);
  await page.setContent('<html data-workspace-theme="dark"><head></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;background:#111210;--font-space-grotesk:Arial;--font-inter:Arial;font:12px Arial}button{font-family:inherit}input,textarea,select{font-family:inherit}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const frame = () => page.$eval('.rmlab-scene', node => Number(node.dataset.frame));
  const category = async index => { await page.click(`.rmlab-categories>button:nth-child(${index + 1})`); await flush(); };
  const tab = async index => { await page.click(`.rmlab-control-tabs>button:nth-child(${index + 1})`); await flush(); };
  const field = async (label, value) => {
    await page.evaluate(({ label, value }) => {
      const element = [...document.querySelectorAll('.rmlab-field')].find(node => node.firstElementChild.textContent === label)?.querySelector('input,textarea,select');
      if (!element) throw new Error(`Missing control: ${label}`);
      const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    }, { label, value });
    await flush();
  };
  const seek = async value => { await page.$eval('[aria-label="Preview frame"]', (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value); await flush(); };

  await page.waitForSelector('.rmlab-scene');
  assert.equal(await page.$$eval('.rmlab-categories>button', nodes => nodes.length), 6);
  assert.equal(await frame(), 60);
  await page.click('[aria-label="Play preview"]');
  await page.waitForFunction(() => Number(document.querySelector('.rmlab-scene').dataset.frame) > 65);
  await page.click('[aria-label="Pause preview"]');
  const paused = await frame();
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 90)));
  assert.equal(await frame(), paused, 'Paused composition has no independent animation clock');
  await seek(112);
  const scene = await page.$('.rmlab-preview');
  const pixels = await scene.screenshot();
  await seek(190); await seek(0); await seek(112);
  assert.deepEqual(await scene.screenshot(), pixels, 'Backward seeking restores the exact same pixels');
  await page.click('[aria-label="Next frame"]'); assert.equal(await frame(), 113);
  await page.click('[aria-label="Previous frame"]'); assert.equal(await frame(), 112);
  await field('Headline', 'An editable explainer');
  assert.equal(await page.$eval('.rmlab-scene-heading h2', node => node.textContent), 'An editable explainer');
  for (const sceneName of ['diagram', 'arrows', 'chart', 'counter', 'cards']) {
    await field('Graphic type', sceneName);
    assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.scene), sceneName);
  }
  await tab(2); await field('Format', 'portrait');
  assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.portrait), 'true');
  await field('Format', 'landscape');
  await tab(1);
  assert.match(await page.$eval('.rmlab-speech-controls', node => node.textContent), /editable sample transcript/);
  await page.click('.rmlab-word-cues>button:nth-child(5)');
  await field('“products,” starts (s)', '2.05');
  await page.click('.rmlab-speech-controls .rmlab-button-row>button:first-child');
  await seek(62);
  await tab(0);
  assert.match(await page.$eval('.rmlab-item-toggle', node => node.textContent), /2\.05s/);

  await category(1);
  assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.scene), 'typography');
  for (const preset of ['word-reveal', 'word-pop', 'slide-title', 'karaoke', 'neon-echo', 'lyric-slam', 'kinetic-stack']) {
    await field('Type treatment', preset); await seek(65);
    assert.ok(await page.$('[data-remotion-text]') || await page.$('.rmlab-scene-typography'), `${preset} renders`);
  }
  await category(0);
  assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.scene), 'cards', 'Returning to Explainers restores a graphic scene');
  await category(4);
  assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.scene), 'polish');
  assert.equal(await page.$$eval('.rmlab-polish-row', nodes => nodes.length), 3);
  await page.$eval('[aria-label="Motion blur"]', input => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '8'); input.dispatchEvent(new Event('input', { bubbles: true })); }); await flush();
  assert.ok(await page.$('.rmlab-polish-ghost'));
  await category(0);
  assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.scene), 'cards');

  await category(5);
  assert.equal(await page.$$eval('.rmlab-template-card', nodes => nodes.length), 7);
  await page.type('[aria-label="Template name"]', ' saved');
  await page.click('.rmlab-save-row button');
  await page.waitForSelector('.rmlab-saved-list>div');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('revline:remotion-lab:templates:v1')).length), 1);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('revline:remotion-lab:templates:v1'))[0].config);
  await writeFile('/tmp/revline-remotion-lab/template.json', JSON.stringify({ type: 'revline-remotion-template', version: 1, config: { ...stored, title: 'Imported motion design' } }));
  await writeFile('/tmp/revline-remotion-lab/invalid.json', JSON.stringify({ version: 999, config: {} }));
  const templateUpload = await page.$('.rmlab-local-templates input[type=file]');
  await templateUpload.uploadFile('/tmp/revline-remotion-lab/invalid.json');
  await page.waitForFunction(() => document.querySelector('.rmlab-notice')?.textContent.includes('version 1'));
  await templateUpload.uploadFile('/tmp/revline-remotion-lab/template.json');
  await page.waitForFunction(() => document.querySelector('.rmlab-scene-heading h2')?.textContent === 'Imported motion design');
  await category(5);
  await page.click('.rmlab-template-card:nth-child(3)');
  assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.scene), 'chart');
  await category(5);
  await page.click('.rmlab-saved-list>div>button:first-child');
  assert.equal(await page.$eval('.rmlab-scene-heading h2', node => node.textContent), 'An editable explainer');

  await category(2); assert.ok(await page.$('[aria-label="Subject tracking experiment"]'));
  await category(3); assert.ok(await page.$('.subject-lab')); assert.equal(await page.$('video[src]'), null);
  assert.equal(requests.filter(url => /api\/sam|segment-video/.test(url)).length, 0, 'Opening subject tools never starts a paid request');
  await category(0);
  await page.evaluate(() => window.labFixture.setEmbedded(true)); await flush();
  await page.setViewport({ width: 360, height: 1000 }); await flush();
  for (let index = 0; index < 6; index++) {
    await category(index);
    const bounds = await page.$eval('.rmlab', node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(bounds.scroll <= bounds.width + 1, `Category ${index + 1} fits the 320px inspector: ${JSON.stringify(bounds)}`);
  }
  await category(0); await seek(180);
  await page.screenshot({ path: '/tmp/revline-remotion-lab/embedded.png', fullPage: true });
  await page.evaluate(() => { window.labFixture.setEmbedded(false); }); await flush();
  await page.setViewport({ width: 1380, height: 1050 }); await flush();
  await page.screenshot({ path: '/tmp/revline-remotion-lab/workspace.png', fullPage: true });
  await page.evaluate(() => window.labFixture.setQuery('tracking')); await flush();
  assert.equal(await page.$$eval('.rmlab-categories>button', nodes => nodes.length), 1);
  assert.ok(await page.$('[aria-label="Subject tracking experiment"]'));
  assert.deepEqual(errors, []);
  console.log('PASS: all six experiments; exact-frame playback/seek; five graphic scenes; all seven text treatments; edited speech cues; motion blur; template save/load/import validation; portrait + 320px embedded layouts; query filtering; no paid SAM requests.');
} finally { await browser.close(); await fonts.close(); }
