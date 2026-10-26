import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
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
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
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
  assert.equal(digest(await scene.screenshot()), digest(pixels), 'Backward seeking restores the exact same pixels');
  await page.click('[aria-label="Next frame"]'); assert.equal(await frame(), 113);
  await page.click('[aria-label="Previous frame"]'); assert.equal(await frame(), 112);
  await field('Block label', 'An editable explainer');
  assert.equal(await page.$eval('.rmlab-block-card h3', node => node.textContent), 'An editable explainer');
  assert.match(await page.$eval('.rmlab-categories>button',node=>node.textContent),/Graphics/);
  assert.equal(await page.$eval('.rmlab-block-type-grid>button',node=>node.dataset.blockChoice),'block-counter','The liked Counter stays prominent');
  const range=async(label,value)=>{await page.$eval(`[aria-label="${label}"]`,(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);await flush();};
  for (const sceneName of ['block-arrow', 'block-label', 'block-chart', 'block-counter', 'block-card']) {
    await page.click(`[data-block-choice="${sceneName}"]`);await flush();
    assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.scene), sceneName);
    assert.deepEqual(await page.$eval('[data-block-canvas]',node=>({background:getComputedStyle(node).backgroundColor,image:getComputedStyle(node).backgroundImage})),{background:'rgb(255, 255, 255)',image:'none'},'Every individual graphic renders on plain white');
    assert.equal(await page.$$eval('[data-block-kind]',nodes=>nodes.length),1,'Only one standalone graphic is previewed');
    if(sceneName==='block-arrow'){
      const curve=await page.$eval('[data-connector-path]',node=>node.getAttribute('d'));
      await range('Curve bend',-.7);assert.notEqual(await page.$eval('[data-connector-path]',node=>node.getAttribute('d')),curve,'Bend edits the actual curved connector');
      await field('Arrow direction','left');assert.match(await page.$eval('.rmlab-block-arrow>g',node=>node.getAttribute('transform')),/rotate\(180/);
      await range('Line weight',5);assert.equal(await page.$eval('[data-arrow-head]',node=>node.getAttribute('stroke-width')),'5');
      await field('Arrow direction','right');await range('Curve bend',.6);await range('Line weight',3);
      await page.screenshot({path:'/tmp/revline-remotion-lab/graphics-arrow.png',fullPage:true});
    }
    if(sceneName==='block-label'){
      await range('Anchor X',80);assert.equal(await page.$eval('[data-callout-target]',node=>Number(node.getAttribute('cx'))),256,'Anchor position edits the visible target dot');
      await field('Anchor direction','left');assert.equal(await page.$eval('[data-callout-target]',node=>Number(node.getAttribute('cx'))),38.4);
      await page.screenshot({path:'/tmp/revline-remotion-lab/graphics-label.png',fullPage:true});
    }
    if(sceneName==='block-counter'){
      await field('Target number','14000000');await field('Number suffix','');await seek(180);
      assert.match(await page.$eval('.rmlab-block-counter',node=>node.textContent),/14,000,000/,'Counter supports the requested large values');
      await page.screenshot({path:'/tmp/revline-remotion-lab/graphics-counter.png',fullPage:true});
    }
  }
  const moreGraphics=['block-progress-ring','block-progress-bar','block-stat-badge','block-checklist','block-steps','block-quote','block-comparison','block-marker','block-highlight','block-lower-third'];
  for(const sceneName of moreGraphics){
    await page.click(`[data-block-choice="${sceneName}"]`);await flush();
    assert.equal(await page.$eval('.rmlab-scene',node=>node.dataset.scene),sceneName);
    if(sceneName==='block-progress-ring'||sceneName==='block-progress-bar'){await field('Block label','Demo progress');await field('Progress (%)',63);}
    else if(sceneName==='block-stat-badge'){await field('Block label','Saved metric');await field('Target number',987);await field('Number prefix','');await field('Number suffix','');}
    else if(sceneName==='block-checklist'){await field('Item 1 label','Reviewed item');await page.evaluate(()=>[...document.querySelectorAll('label')].find(node=>node.textContent.includes('Item 1 complete')).querySelector('input').click());}
    else if(sceneName==='block-steps'){await field('Item 1 label','Draft');await field('Item 1 detail','Start here');}
    else if(sceneName==='block-quote'){await field('Attribution','Taylor');await field('Quote text','A clear quote deserves room to breathe.');}
    else if(sceneName==='block-comparison'){await field('Side 1 label','Before');await field('Item 1 value',18);await field('Side 2 label','After');await field('Item 2 value',54);}
    else if(sceneName==='block-marker'){await field('Event label','Launch');await field('Timestamp / detail','00:42');await range('Marker position',25);}
    else if(sceneName==='block-highlight'){await field('Optional label','Focus');await range('Line weight',5);}
    else if(sceneName==='block-lower-third'){await field('Name','Taylor');await field('Role / subtitle','Creative lead');}
    await seek(0);const empty=digest(await scene.screenshot());await seek(60);const settled=digest(await scene.screenshot());
    assert.notEqual(empty,settled,`${sceneName} actually animates into a rendered graphic`);
    await seek(180);await seek(0);await seek(60);assert.equal(digest(await scene.screenshot()),settled,`${sceneName} seeks deterministically`);
    assert.equal(await page.$eval('[data-block-canvas]',node=>getComputedStyle(node).backgroundColor),'rgb(255, 255, 255)');
    const content=await page.$eval('[data-block-kind]',node=>node.textContent);
    if(sceneName==='block-progress-ring'||sceneName==='block-progress-bar')assert.match(content,/63/);
    if(sceneName==='block-stat-badge')assert.match(content,/987/);
    if(sceneName==='block-checklist')assert.equal(await page.$eval('.rmlab-graphic-list i',node=>node.dataset.checked),'false');
    if(sceneName==='block-steps')assert.match(content,/Draft.*Start here/);
    if(sceneName==='block-quote')assert.match(content,/A clear quote.*Taylor/);
    if(sceneName==='block-comparison')assert.match(content,/Before.*18.*After.*54/);
    if(sceneName==='block-marker')assert.match(content,/Launch.*00:42/);
    if(sceneName==='block-highlight')assert.equal(await page.$eval('.rmlab-graphic-highlight ellipse',node=>node.getAttribute('stroke-width')),'5');
    if(sceneName==='block-lower-third')assert.match(content,/Taylor.*Creative lead/);
    await page.screenshot({path:`/tmp/revline-remotion-lab/graphics-${sceneName.slice(6)}.png`,fullPage:true});
  }
  assert.equal(await page.$$eval('.rmlab-block-type-grid>button',nodes=>nodes.length),15);
  await page.click('[data-block-choice="block-card"]');await flush();await field('Block label','An editable explainer');await field('Trigger word','products');
  await tab(2); await field('Format', 'portrait');
  assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.portrait), 'true');
  await field('Format', 'landscape');
  await range('Position X',70);assert.equal(await page.$eval('.rmlab-block-position',node=>node.style.left),'70%');await range('Position X',50);
  await tab(1);
  assert.match(await page.$eval('.rmlab-speech-controls', node => node.textContent), /editable sample transcript/);
  await page.click('.rmlab-word-cues>button:nth-child(5)');
  await field('“products,” starts (s)', '2.05');
  await page.click('.rmlab-speech-controls .rmlab-button-row>button:first-child');
  await seek(62);
  await tab(0);
  assert.equal(await page.$eval('[aria-label="Composition controls"] .rmlab-field input[max="8"]',node=>Number(node.value)),2.05);

  await category(1);
  await field('Title / animated text','An editable explainer');
  assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.scene), 'typography');
  for (const preset of ['word-reveal', 'word-pop', 'slide-title', 'karaoke', 'neon-echo', 'lyric-slam', 'kinetic-stack']) {
    await field('Type treatment', preset); await seek(65);
    assert.ok(await page.$('[data-remotion-text]') || await page.$('.rmlab-scene-typography'), `${preset} renders`);
  }
  assert.equal(await page.$$eval('.rmlab-field select optgroup option', nodes => nodes.length), 24, 'Fourteen production and ten experimental treatments are available');
  assert.equal(await page.$$eval('.rmlab-new-type-grid>button', nodes => nodes.length), 10);
  assert.equal(await page.$$eval('.rmlab-new-type-grid>button', nodes => nodes.some(node=>/Chromatic split|Outline trails|Cinematic focus|Character scramble|Spotlight sweep|Ink write-on|Echo tunnel/.test(node.textContent))),false,'Approved treatments leave the experimental review grid');
  for(const preset of ['rgb-split','type-trails','blur-focus','character-scramble','spotlight-sweep','ink-write','tunnel-zoom']){
    await field('Type treatment',preset);await seek(7);
    assert.ok(await page.$(`[data-remotion-text="${preset}"]`),'Promoted lab entries use the actual production renderer');
    assert.ok(await page.$('[aria-label="Effect strength"]'));
  }
  const extras = ['flip-words', 'line-wipe', 'elastic-wave', 'shutter-slice', 'iris-reveal', 'liquid-stretch', 'orbit-assembly', 'stamp-impact', 'diagonal-stagger', 'soft-bloom'];
  for (const preset of extras) {
    await field('Type treatment', preset);
    await page.waitForSelector(`[data-lab-text="${preset}"]`);
    await page.waitForFunction(() => Number(document.querySelector('.rmlab-scene').dataset.frame) >= 2);
    await seek(7);
    const entrance = await scene.screenshot();
    await seek(150); const settled = await scene.screenshot();
    assert.notEqual(digest(entrance), digest(settled), `${preset} has an actual visible entrance`);
    await seek(0); await seek(7);
    assert.equal(digest(await scene.screenshot()), digest(entrance), `${preset} restores the same pixels after backward seek`);
    const setRange = async (label, value) => { await page.$eval(`[aria-label="${label}"]`, (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value); await flush(); };
    await setRange('Effect strength', .2); const subtle = await scene.screenshot();
    await setRange('Effect strength', 2); assert.notEqual(digest(await scene.screenshot()), digest(subtle), `${preset} strength edits change pixels`);
    await setRange('Effect strength', 1);
    await setRange('Reveal duration', 1.2); const slow = await scene.screenshot();
    await setRange('Reveal duration', .4); assert.notEqual(digest(await scene.screenshot()), digest(slow), `${preset} duration edits change pixels`);
    await setRange('Reveal duration', .65);
    await page.screenshot({ path: `/tmp/revline-remotion-lab/type-${preset}.png`, fullPage: true });
  }
  await field('Type treatment','blur-focus');await seek(90);
  await field('Title / animated text','A cinematic title with stable line breaks throughout every frame');
  const geometry=()=>page.$$eval('[data-focus-word]',nodes=>nodes.map(node=>({left:node.offsetLeft,top:node.offsetTop,width:node.offsetWidth,height:node.offsetHeight})));
  await seek(0);const resting=await geometry();
  assert.ok(new Set(resting.map(word=>word.top)).size>1,'Focus fixture spans multiple lines');
  for(const frame of [3,9,25,60,150]){await seek(frame);assert.deepEqual(await geometry(),resting,'Focus keeps exactly the same word layout before, during and after its reveal');}
  const flat=digest(await scene.screenshot());
  for(const style of ['extruded','chrome','neon-depth']){
    await field('Text appearance',style);
    assert.ok(await page.$(`[data-depth-style="${style}"]`));
    assert.notEqual(digest(await scene.screenshot()),flat,`${style} adds independent depth appearance`);
    await page.screenshot({path:`/tmp/revline-remotion-lab/depth-${style}.png`,fullPage:true});
  }
  const initialDepth=digest(await scene.screenshot());
  for(const [label,value] of [['Text depth',14],['Text tilt X',15],['Text tilt Y',-18]]){
    await page.$eval(`[aria-label="${label}"]`,(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);await flush();
  }
  assert.notEqual(digest(await scene.screenshot()),initialDepth,'Depth and real CSS perspective/tilt controls change the composed appearance');
  await field('Text appearance','flat');assert.equal(await page.$('.rmlab-type-depth'),null);
  await field('Title / animated text','An editable explainer');
  await category(0);
  assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.scene), 'block-card', 'Returning to Graphics restores one independent element');
  await tab(3);
  await page.$eval('[aria-label="Motion blur"]', input => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '8'); input.dispatchEvent(new Event('input', { bubbles: true })); }); await flush();
  assert.ok(await page.$('.rmlab-motion-sample'), 'Individual motion blur remains available');
  assert.equal(await page.$$eval('.rmlab-categories>button', nodes => nodes.some(node=>node.textContent.includes('Motion polish'))),false);
  await tab(0);

  await category(5);
  assert.equal(await page.$$eval('.rmlab-template-card', nodes => nodes.length), 7);
  await page.type('[aria-label="Template name"]', ' saved');
  await page.click('.rmlab-save-row button');
  await page.waitForSelector('.rmlab-saved-list>div');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('revline:remotion-lab:templates:v1')).length), 1);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('revline:remotion-lab:templates:v1'))[0].config);
  await writeFile('/tmp/revline-remotion-lab/template.json', JSON.stringify({ type: 'revline-remotion-template', version: 1, config: { ...stored, title: 'Imported motion design',items:stored.items.map((item,index)=>index?item:{...item,label:'Imported motion design'}) } }));
  await writeFile('/tmp/revline-remotion-lab/invalid.json', JSON.stringify({ version: 999, config: {} }));
  const templateUpload = await page.$('.rmlab-local-templates input[type=file]');
  await templateUpload.uploadFile('/tmp/revline-remotion-lab/invalid.json');
  await page.waitForFunction(() => document.querySelector('.rmlab-notice')?.textContent.includes('version 1'));
  await templateUpload.uploadFile('/tmp/revline-remotion-lab/template.json');
  await page.waitForFunction(() => document.querySelector('.rmlab-block-card h3')?.textContent === 'Imported motion design');
  await category(5);
  await page.click('.rmlab-template-card:nth-child(3)');
  assert.equal(await page.$eval('.rmlab-scene', node => node.dataset.scene), 'block-chart');
  await category(5);
  await page.click('.rmlab-saved-list>div>button:first-child');
  assert.equal(await page.$eval('.rmlab-block-card h3', node => node.textContent), 'An editable explainer');

  await category(3); assert.ok(await page.$('[aria-label="Subject tracking experiment"]'));
  await category(4); assert.ok(await page.$('.subject-lab')); assert.equal(await page.$('video[src]'), null);
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
  console.log('PASS: all six areas; exact-frame playback/seek; fifteen editable independent graphics on white; curved arrow/head + anchored label controls; fourteen production plus ten experimental text treatments; deterministic pixels and data/strength/timing edits; speech cues; motion blur; template validation; portrait + 320px embedded layouts; zero paid SAM requests.');
} finally { await browser.close(); await fonts.close(); }
