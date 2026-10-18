import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// Real components with generated text and local callbacks; no account/API use.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import './components/workspace/workspace-pages.css';import './app/editor.css';import './components/workspace/shared.css';
import {AssistantPanel} from './components/editor/assistant-panel';import {ColorLookPicker} from './components/editor/color-look-picker';import {VisualEffectsControls} from './components/editor/visual-effects-controls';
import {InspectorSelect} from './components/editor/inspector-select';import {colorLookGrade} from './lib/editor/color-looks';
const root=createRoot(document.getElementById('root'));window.calls=[];window.state={view:'chat',messages:[],running:false};
const name='raw_footage_'+('LongFilename'.repeat(14))+'.mp4';window.longName=name;
function Color(){const [clip,setClip]=useState(()=>({id:'source',kind:'video',track:1,start:0,duration:3,sourceStart:0,colorGrade:colorLookGrade('warm-film')}));const [choice,setChoice]=useState('contain');return <div className="color-fixture"><VisualEffectsControls clip={clip} onlyEffect="colorGrade" onChange={patch=>setClip(previous=>({...previous,...patch}))}/><InspectorSelect label="Footage fit" value={choice} options={[{value:'contain',label:'Show full clip'},{value:'cover',label:'Fill the frame'}]} onChange={setChoice}/></div>}
window.renderFixture=patch=>{Object.assign(window.state,patch);flushSync(()=>root.render(window.state.view==='color'?<Color/>:window.state.view==='colorDisabled'?<ColorLookPicker disabled onSelect={()=>window.calls.push('disabled-selected')}/>:<AssistantPanel key={window.state.key??0} {...window.state} modelSwitcher allowedModels={['haiku','sonnet','opus','gpt-6.1-sol','gpt-6-astra']} defaultModelChoice="gpt-6-astra" configured hasClips demo={false} onSend={async()=>{}} onStop={async()=>{}} onAttach={()=>{}} onRemoveAttachment={id=>{window.calls.push({removed:id});window.renderFixture({attachments:window.state.attachments.filter(a=>a.id!==id)})}} onSuggestion={async()=>{}}/>));};window.renderFixture({});
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-mobile-chat', define: { 'process.env.NODE_ENV': '"development"' } });
const server = createServer((_request, response) => response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const failures = [], checks = [], errors = [];
try {
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  for (const [width, height, touch] of [[320, 740, true], [360, 780, true], [390, 844, true], [430, 932, true], [844, 390, true], [1280, 800, false]]) {
    await page.setViewport({ width, height, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.setContent('<html data-workspace-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" class="conversation-editor"></main></body></html>');
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
    await page.addStyleTag({ content: ':root{--background:#191a1b;--foreground:#eee;--secondary:#252628;--border:#353739;--ws-text:#eee;--ws-muted:#aaa;--ws-hover:#303234;--ws-surface:#252628;--ws-input:#252628}*{box-sizing:border-box}body{margin:0;background:#191a1b;color:#eee;font:13px Arial}#root{width:min(360px,calc(100% - 24px));height:calc(100dvh - 24px);margin:12px auto;display:flex;flex-direction:column;min-width:0}.color-fixture{display:grid;gap:12px;min-width:0;overflow-y:auto;flex:1}button{font:inherit}' });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    const states = ['welcome', 'messages', 'suggestions', 'error', 'working', 'attachments'];
    for (const [key, state] of states.entries()) {
      await page.evaluate(({ state, key }) => {
        const name = window.longName;
        const messages = [{ id: 'user', role: 'user', text: 'Tighten this footage and add captions.' }, { id: 'reply', role: 'assistant', text: '# ' + name + '\n\n- ' + name + '\n- The edit preserves complete sentences and audio sync.\n\n' + 'A clear result. '.repeat(40), status: 'success' }];
        window.renderFixture({ key, view: 'chat', messages: ['messages', 'error', 'working'].includes(state) ? messages : [], error: state === 'error' ? 'Could not process ' + name : undefined, running: state === 'working', activity: state === 'working' ? 'Watching footage…' : undefined, activitySource: state === 'working' ? name : undefined, suggestions: state === 'suggestions' ? { sourceName: name, clipId: 'source', items: [{ label: name, prompt: 'Tighten', start: 0, end: 1 }] } : undefined, attachments: state === 'attachments' ? [{ id: 'a', name, progress: 60 }, { id: 'b', name: name + '2', error: 'Could not process ' + name }] : undefined });
      }, { state, key });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const measurement = await page.evaluate(() => {
        const history = document.querySelector('.assistant-history'), textarea = document.querySelector('textarea'), composer = document.querySelector('.manual-editor-composer'), button = document.querySelector('[aria-label="AI editing model"]');
        const box = composer.getBoundingClientRect();
        const targets = [...document.querySelectorAll('.composer-add,.composer-submit,[aria-label="Stop editing"],.assistant-model-picker button,.composer-attachment>button')].filter(node => !node.disabled).map(node => ({ label: node.getAttribute('aria-label'), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
        return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, historyWidth: history.clientWidth, historyContent: history.scrollWidth, composerBottom: box.bottom, viewportHeight: innerHeight, inputFont: getComputedStyle(textarea).fontSize, modelFont: getComputedStyle(button.querySelector('.inspector-select-value')).fontSize, targets, coarse: matchMedia('(pointer:coarse)').matches };
      });
      checks.push({ width, height, state, ...measurement });
      if (measurement.pageWidth > measurement.width + 1 || measurement.historyContent > measurement.historyWidth + 1) failures.push({ width, state, issue: 'horizontal overflow', measurement });
      if (measurement.composerBottom > measurement.viewportHeight + 1) failures.push({ width, state, issue: 'composer below viewport', measurement });
      if (measurement.inputFont !== '14px' || measurement.modelFont !== '13px') failures.push({ width, state, issue: 'composer typography mismatch', measurement });
      if (touch && measurement.targets.some(target => target.width < 44 || target.height < 44)) failures.push({ width, state, issue: 'touch target under 44px', targets: measurement.targets });
    }
    if(touch){const remove=await page.$('.composer-attachment>button'),box=await remove.boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);assert.equal(await page.evaluate(()=>window.calls.at(-1).removed),'a','The attachment remove target responds to touch.');}
    await page.click('[aria-label="AI editing model"]'); await page.waitForSelector('[role="menu"]');
    const menu = await page.$eval('[role="menu"]', node => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight }; });
    if (menu.left < 0 || menu.right > menu.width + 1 || menu.top < 0 || menu.bottom > menu.height + 1) failures.push({ width, issue: 'model menu clipped', menu });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.renderFixture({ view: 'color' }));
    await page.click('[aria-label="Apply Noir"]');
    const slider = await page.$eval('[aria-label="Color look strength"]', node => { const box = node.getBoundingClientRect(); return { width: box.width, height: box.height, value: Number(node.value) }; });
    if (touch && slider.height < 44) failures.push({ width, issue: 'color strength touch target under 44px', slider });
    await page.focus('[aria-label="Color look strength"]'); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval('[aria-label="Color look strength"]', node => Number(node.value)), .01, 'Color strength remains editable after selecting a preset.');
    if(touch){const range=await page.$('[aria-label="Color look strength"]');await range.scrollIntoView();const box=await range.boundingBox();await page.touchscreen.tap(box.x+box.width*.75,box.y+box.height/2);assert.ok(await range.evaluate(node=>Number(node.value)>.5),'Touch can change the full strength slider.');}
    const fit = await page.$eval('[aria-label="Footage fit"]', node => { const box = node.getBoundingClientRect(); return { width: box.width, height: box.height }; });
    if (touch && fit.height < 44) failures.push({ width, issue: 'fit selector touch target under 44px', fit });
    await page.click('[aria-label="Footage fit"]'); await page.waitForSelector('[role="menuitemradio"][data-value="cover"]');
    const optionHeight = await page.$eval('[role="menuitemradio"][data-value="cover"]', node => node.getBoundingClientRect().height);
    if (touch && optionHeight < 44) failures.push({ width, issue: 'fit menu touch target under 44px', optionHeight });
    await page.click('[role="menuitemradio"][data-value="cover"]');
    const effectTargets = await page.$$eval('.visual-effect-heading button', nodes => nodes.map(node => ({label:node.getAttribute('aria-label'),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
    if(touch && effectTargets.some(target=>target.height<44||target.width<44)) failures.push({width,issue:'effect header touch target under44px',effectTargets});
    await page.evaluate(()=>window.renderFixture({view:'colorDisabled'}));
    assert.equal(await page.$$eval('.color-look-picker button',nodes=>nodes.length===5&&nodes.every(node=>node.disabled)),true,'No-clip color presets cannot apply an edit.');
  }
  console.log(JSON.stringify({ checkedStates: checks.length, failures }, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  console.log('PASS: real chat, composer, model menu, color presets, strength and fit controls fit phone/landscape/desktop viewports; touch targets remain usable. Generated fixture only.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
