import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import {createServer} from 'node:http';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import './components/workspace/workspace-pages.css';import './app/editor.css';import './components/workspace/shared.css';
import {AssistantPanel} from './components/editor/assistant-panel';import {EditComposer} from './components/workspace/edit-composer';
const root=createRoot(document.getElementById('root'));window.calls=[];window.state={modelSwitcher:true,allowedModels:['haiku','sonnet','opus','gpt-6.1-sol','gpt-6-astra'],running:false,messages:[]};
window.renderFixture=patch=>{Object.assign(window.state,patch);flushSync(()=>root.render(<>
 <AssistantPanel key={window.state.fixtureKey??0} {...window.state} configured hasClips demo={false} onSend={async(text,model)=>{window.calls.push({text,model});throw new Error('Fixture request recorded');}} onStop={async()=>{}}/>
 <div className="studio-fixture"><EditComposer value="Studio" onChange={()=>{}} onSubmit={()=>{}}/></div>
</>));};window.renderFixture({});
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-model-picker', define: { 'process.env.NODE_ENV': '"production"' } });
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<html><body></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
 const page = await browser.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewport({width:500,height:620});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.setContent('<html data-workspace-theme="dark"><body><main id="root" class="conversation-editor"></main></body></html>');
 await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
 await page.addStyleTag({content:':root{--background:#191a1b;--foreground:#eee;--secondary:#252628;--border:#353739;--ws-text:#eee;--ws-muted:#aaa;--ws-hover:#303234;--ws-surface:#252628}*{box-sizing:border-box}body{margin:0;background:#191a1b;color:#eee;font:13px Arial}#root{width:360px;margin:20px;display:flex;flex-direction:column}.assistant-content{height:350px;display:flex;flex-direction:column}.assistant-history{flex:1}.manual-composer-dock{margin-top:auto}.studio-fixture{margin-top:40px}button{font:inherit}'});
 await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
 await page.waitForSelector('[aria-label="AI editing model"]');
 assert.equal(await page.$eval('[aria-label="AI editing model"]',el=>el.textContent),'Sonnet 5.5');
 const geometry=await page.$$eval('.composer-submit',els=>els.map(el=>{const rect=el.getBoundingClientRect();return {width:rect.width,height:rect.height,shadow:getComputedStyle(el).boxShadow};}));
 assert.equal(geometry[0].width,28);assert.equal(geometry[0].height,28);assert.equal(geometry[0].shadow,'none');
 assert.equal(geometry[1].width,32);assert.equal(geometry[1].height,32,'Other composer variants keep their sizing');
 const choices=[['haiku','Haiku 5.5'],['sonnet','Sonnet 5.5'],['opus','Opus 5.5'],['gpt-6.1-sol','GPT-6.1 Sol'],['gpt-6-astra','GPT-6 Astra']];
 for(const [index,[choice,label]] of choices.entries()){
  await page.click('[aria-label="AI editing model"]');
  await page.waitForSelector(`[role="menuitemradio"][data-value="${choice}"]`);
  assert.equal(await page.$eval(`[role="menuitemradio"][data-value="${choice}"] .inspector-select-value`,el=>el.scrollWidth<=el.clientWidth),true,'Every model name remains readable');
  assert.equal(await page.$eval(`[role="menuitemradio"][data-value="${choice}"] .inspector-select-value`,el=>el.textContent),label);assert.equal(await page.$eval(`[role="menuitemradio"][data-value="${choice}"] small`,el=>el.textContent),{haiku:'Fast, simple edits',sonnet:'Everyday editing',opus:'Complex, coordinated edits','gpt-6.1-sol':'OpenAI · everyday editing','gpt-6-astra':'OpenAI · complex editing'}[choice]);
  await page.click(`[role="menuitemradio"][data-value="${choice}"]`);
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='AI editing model');
  await page.type('.assistant-content textarea',`Test ${choice}`);
  await page.waitForFunction(()=>!document.querySelector('.assistant-content .composer-submit').disabled);
  await page.click('.assistant-content .composer-submit');
  await page.waitForFunction(count=>window.calls.length===count,{},index+1);
  assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{text:`Test ${choice}`,model:choice});
  await page.waitForFunction(()=>!document.querySelector('.assistant-content textarea').disabled);
  await page.focus('.assistant-content textarea');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
 }
 // A production allowlist must hide Opus and immediately reset a stale local selection.
 await page.evaluate(()=>window.renderFixture({allowedModels:['haiku','sonnet']}));
 assert.equal(await page.$eval('[aria-label="AI editing model"]',el=>el.textContent),'Sonnet 5.5');
 await page.click('[aria-label="AI editing model"]');
 await page.waitForSelector('[role="menuitemradio"][data-value="sonnet"]');
 assert.equal(await page.$('[role="menuitemradio"][data-value="opus"]'),null);
 assert.equal(await page.$('[role="menuitemradio"][data-value="gpt-6.1-sol"]'),null);
 assert.equal(await page.$('[role="menuitemradio"][data-value="gpt-6-astra"]'),null);
 await page.click('[role="menuitemradio"][data-value="sonnet"]');
 await page.evaluate(()=>window.renderFixture({running:true}));
 assert.equal(await page.$eval('[aria-label="AI editing model"]',el=>el.disabled),true,'The model stays fixed while editing');
 assert.equal(await page.$eval('[aria-label="Stop editing"]',el=>el.getBoundingClientRect().width),28);
 await page.evaluate(()=>window.renderFixture({running:false,modelSwitcher:false}));
 assert.equal(await page.$('[aria-label="AI editing model"]'),null);
 await page.type('.assistant-content textarea','Default run');await page.waitForFunction(()=>!document.querySelector('.assistant-content .composer-submit').disabled);
  await page.click('.assistant-content .composer-submit');
 await page.waitForFunction(()=>window.calls.length===6);
 assert.equal(await page.evaluate(()=>window.calls.at(-1).model),undefined,'Hidden selector preserves the backend default');
 await page.waitForFunction(()=>!document.querySelector('.assistant-content textarea').disabled);
 await page.evaluate(()=>window.renderFixture({modelSwitcher:true,fixtureKey:1,allowedModels:['haiku','sonnet','gpt-6.1-sol','gpt-6-astra']}));
 await page.focus('.assistant-content textarea');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
 await page.type('.assistant-content textarea','Make this tighter');
 await page.click('[aria-label="AI editing model"]');
 await page.waitForSelector('[role="menuitemradio"][data-value="gpt-6-astra"]');
 await page.screenshot({path:'/tmp/revline-composer-model-picker.png'});
 await page.keyboard.press('Escape');
 await page.setViewport({width:320,height:620});
 await page.addStyleTag({content:'#root{width:280px;margin:20px}'});
 await page.click('[aria-label="AI editing model"]');
 await page.waitForSelector('[role="menuitemradio"][data-value="gpt-6-astra"]');
 const rect=await page.$eval('[role="menu"]',el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right};});
 assert(rect.left>=0&&rect.right<=320,'Model menu remains within narrow panel');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>window.renderFixture({fixtureKey:2,defaultModelChoice:undefined}));
 assert.equal(await page.$eval('[aria-label="AI editing model"]',el=>el.textContent),'Sonnet 5.5');
 await page.evaluate(()=>window.renderFixture({defaultModelChoice:'gpt-6.1-sol'}));
 assert.equal(await page.$eval('[aria-label="AI editing model"]',el=>el.textContent),'GPT-6.1 Sol','The authoritative backend default arrives without requiring a remount');
 await page.focus('.assistant-content textarea');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
 await page.type('.assistant-content textarea','Use the configured default');await page.click('.assistant-content .composer-submit');
 await page.waitForFunction(()=>window.calls.length===7);
 assert.equal(await page.evaluate(()=>window.calls.at(-1).model),undefined,'An untouched picker preserves the backend default instead of overriding it with Sonnet');
 await page.waitForFunction(()=>!document.querySelector('.assistant-content textarea').disabled);
 await page.click('[aria-label="AI editing model"]');await page.waitForSelector('[role="menuitemradio"][data-value="sonnet"]');await page.click('[role="menuitemradio"][data-value="sonnet"]');
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='AI editing model');
 await page.focus('.assistant-content textarea');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
 await page.type('.assistant-content textarea','Choose Sonnet explicitly');await page.waitForFunction(()=>!document.querySelector('.assistant-content .composer-submit').disabled);await page.click('.assistant-content .composer-submit');
 await page.waitForFunction(()=>window.calls.length===8);
 assert.equal(await page.evaluate(()=>window.calls.at(-1).model),'sonnet','Sonnet remains explicitly selectable when Sol is the backend default');
 assert.deepEqual(errors,[]);
 console.log('PASS: picker follows the backend default without overriding untouched sends; Sonnet and all other native choices remain selectable; environment allowlist, run lock and compact geometry preserved. Synthetic fixture only.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
