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
 <AssistantPanel key={window.state.fixtureKey??0} {...window.state} configured hasClips demo={false} onSend={async(text,model,reasoningEffort,speedMode)=>{window.calls.push({text,model,reasoningEffort,speedMode});throw new Error('Fixture request recorded');}} onStop={async()=>{}} onSuggestion={async(text,clipId,model,reasoningEffort,speedMode)=>{window.calls.push({text,clipId,model,reasoningEffort,speedMode});throw new Error('Fixture suggestion recorded');}}/>
 <div className="studio-fixture"><EditComposer value="Studio" onChange={()=>{}} onSubmit={()=>{}}/></div>
</>));};window.renderFixture({});
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-model-picker', define: { 'process.env.NODE_ENV': '"development"' } });
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<html><body></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
 const page = await browser.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewport({width:500,height:620});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.setContent('<html data-workspace-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" class="conversation-editor"></main></body></html>');
 await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
 await page.addStyleTag({content:':root{--background:#191a1b;--foreground:#eee;--secondary:#252628;--border:#353739;--ws-text:#eee;--ws-muted:#aaa;--ws-hover:#303234;--ws-surface:#252628}*{box-sizing:border-box}body{margin:0;background:#191a1b;color:#eee;font:13px Arial}#root{width:360px;margin:20px;display:flex;flex-direction:column}.assistant-content{height:350px;display:flex;flex-direction:column}.assistant-history{flex:1}.manual-composer-dock{margin-top:auto}.studio-fixture{margin-top:40px}button{font:inherit}'});
 await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
 await page.waitForSelector('[aria-label="AI editing model"]');
 assert.equal(await page.$eval('[aria-label="AI editing model"]',el=>el.textContent),'GPT-6.1 Sol');
 assert.equal(await page.$eval('[aria-label="AI editing model"] .inspector-select-value',el=>getComputedStyle(el).fontSize),'13px','The actual model label is visually subordinate to the composer text');
 assert.equal(await page.$eval('.manual-editor-composer textarea',el=>getComputedStyle(el).fontSize),'14px','Typing text retains its 14px size');
 assert.equal(await page.$eval('.manual-editor-composer',node=>{const input=node.querySelector('textarea').getBoundingClientRect(),actions=node.querySelector('.edit-composer-actions').getBoundingClientRect();return input.height>=44&&actions.top-input.bottom>=11}),true,'Text input sits above a separate model/action row');
 const addInset=await page.$eval('.manual-editor-composer',node=>{const form=node.getBoundingClientRect(),add=node.querySelector('.composer-add').getBoundingClientRect(),send=node.querySelector('.composer-submit').getBoundingClientRect();return {left:add.left-form.left,right:form.right-send.right}});assert.equal(addInset.left,addInset.right,'Attach and send buttons use equal composer insets');
 const geometry=await page.$$eval('.composer-submit',els=>els.map(el=>{const rect=el.getBoundingClientRect();return {width:rect.width,height:rect.height,shadow:getComputedStyle(el).boxShadow};}));
 assert.equal(geometry[0].width,28);assert.equal(geometry[0].height,28);assert.equal(geometry[0].shadow,'none');
 assert.equal(geometry[1].width,32);assert.equal(geometry[1].height,32,'Other composer variants keep their sizing');
 const choices=[['gpt-6.1-sol','GPT-6.1 Sol'],['gpt-6-astra','GPT-6 Astra']];
 for(const [index,[choice,label]] of choices.entries()){
  await page.click('[aria-label="AI editing model"]');await page.waitForSelector(`[role="menuitemradio"][data-value="${choice}"]`);
  assert.equal(await page.$$eval('[role="menuitemradio"]',nodes=>nodes.length),2,'Only supported GPT models are offered, even with a stale legacy allowlist');
  assert.equal(await page.$eval(`[role="menuitemradio"][data-value="${choice}"] .inspector-select-value`,el=>el.textContent),label);
  for(const stale of ['haiku','sonnet','opus'])assert.equal(await page.$(`[role="menuitemradio"][data-value="${stale}"]`),null);
  await page.click(`[role="menuitemradio"][data-value="${choice}"]`);await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='AI editing model');
  if(index===0)assert.equal(await page.$eval('[aria-label="AI reasoning effort"]',node=>node.textContent),'Medium');
  await page.click('[aria-label="AI reasoning effort"]');await page.waitForSelector('[role="menuitemradio"][data-value="high"]');assert.equal(await page.$$eval('[role="menuitemradio"]',nodes=>nodes.length),5);
  await page.click('[role="menuitemradio"][data-value="high"]');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='AI reasoning effort');
  await page.click('[aria-label="AI speed mode"]');await page.waitForSelector('[role="menuitemradio"][data-value="fast"]');assert.equal(await page.$eval('[role="menuitemradio"][data-value="fast"] small',node=>node.textContent),'2× token cost');
  await page.click('[role="menuitemradio"][data-value="fast"]');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='AI speed mode');
  await page.type('.assistant-content textarea',`Test ${choice}`);await page.click('.assistant-content .composer-submit');await page.waitForFunction(count=>window.calls.length===count,{},index+1);
  assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{text:`Test ${choice}`,model:choice,reasoningEffort:'high',speedMode:'fast'});
  await page.waitForFunction(()=>!document.querySelector('.assistant-content textarea').disabled);await page.focus('.assistant-content textarea');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
 }
 await page.evaluate(()=>window.renderFixture({running:true}));for(const label of ['AI editing model','AI reasoning effort','AI speed mode'])assert.equal(await page.$eval(`[aria-label="${label}"]`,node=>node.disabled),true);
 await page.evaluate(()=>window.renderFixture({running:false,allowedModels:['gpt-6.1-sol']}));assert.equal(await page.$eval('[aria-label="AI editing model"]',node=>node.textContent),'GPT-6.1 Sol');
 await page.evaluate(()=>window.renderFixture({modelSwitcher:false}));for(const label of ['AI editing model','AI reasoning effort','AI speed mode'])assert.equal(await page.$(`[aria-label="${label}"]`),null);
 await page.type('.assistant-content textarea','Default run');await page.click('.assistant-content .composer-submit');await page.waitForFunction(()=>window.calls.length===3);assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{text:'Default run'});
 await page.waitForFunction(()=>!document.querySelector('.assistant-content textarea').disabled);
 await page.evaluate(()=>window.renderFixture({fixtureKey:1,modelSwitcher:true,allowedModels:['gpt-6.1-sol','gpt-6-astra'],defaultModelChoice:'gpt-6-astra'}));
 await page.setViewport({width:320,height:620});await page.addStyleTag({content:'#root{width:280px;margin:20px}'});
 for(const label of ['AI editing model','AI reasoning effort','AI speed mode']){assert.equal(await page.$eval(`[aria-label="${label}"] .inspector-select-value`,node=>getComputedStyle(node).fontSize),'13px');await page.click(`[aria-label="${label}"]`);await page.waitForSelector('[role="menu"]');const bounds=await page.$eval('[role="menu"]',node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right}});assert.ok(bounds.left>=0&&bounds.right<=320);await page.keyboard.press('Escape');await page.waitForFunction(label=>document.activeElement?.getAttribute('aria-label')===label,{},label);}
 await page.type('.assistant-content textarea','Configured default');await page.click('.assistant-content .composer-submit');await page.waitForFunction(()=>window.calls.length===4);assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{text:'Configured default',reasoningEffort:'medium',speedMode:'standard'});
 await page.waitForFunction(()=>!document.querySelector('.assistant-content textarea').disabled);await page.evaluate(()=>window.renderFixture({fixtureKey:2,defaultModelChoice:'gpt-6.1-sol',suggestions:{sourceName:'Fixture footage',clipId:'fixture-clip',items:[{label:'Tighten pauses',prompt:'Tighten pauses',start:0,end:3}]}}));
 for(const [label,value] of [['AI reasoning effort','max'],['AI speed mode','fast']]){await page.click(`[aria-label="${label}"]`);await page.waitForSelector(`[role="menuitemradio"][data-value="${value}"]`);await page.click(`[role="menuitemradio"][data-value="${value}"]`);await page.waitForFunction(label=>document.activeElement?.getAttribute('aria-label')===label,{},label);}
 await page.click('.assistant-source-suggestions button');await page.waitForFunction(()=>window.calls.length===5);assert.deepEqual(await page.evaluate(()=>({clipId:window.calls.at(-1).clipId,reasoningEffort:window.calls.at(-1).reasoningEffort,speedMode:window.calls.at(-1).speedMode})),{clipId:'fixture-clip',reasoningEffort:'max',speedMode:'fast'});
 const fixtureStyles=await page.$$eval('style',nodes=>nodes.map(node=>node.textContent));
 await page.setViewport({width:320,height:740,isMobile:true,hasTouch:true,deviceScaleFactor:1});
 // Switching touch emulation reloads this synthetic server page; remount its generated fixture.
 await page.setContent('<html data-workspace-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" class="conversation-editor"></main></body></html>');
 for(const content of fixtureStyles)await page.addStyleTag({content});
 await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
 await page.evaluate(()=>window.renderFixture({defaultModelChoice:'gpt-6.1-sol'}));
 await page.waitForSelector('[aria-label="AI speed mode"]');
 const touchInset=await page.$eval('.manual-editor-composer',node=>{const form=node.getBoundingClientRect(),add=node.querySelector('.composer-add').getBoundingClientRect(),send=node.querySelector('.composer-submit').getBoundingClientRect();return {left:add.left-form.left,right:form.right-send.right}});assert.equal(touchInset.left,touchInset.right,'Touch attach and send buttons keep equal insets');
 const touchControls=await page.$eval('.assistant-model-controls',node=>{const group=node.getBoundingClientRect(),composer=node.closest('.manual-editor-composer').getBoundingClientRect();return {height:group.height,inside:group.left>=composer.left&&group.right<=composer.right&&group.bottom<=composer.bottom,targets:[...node.querySelectorAll('button')].map(button=>({height:button.getBoundingClientRect().height,width:button.getBoundingClientRect().width}))}});
 assert.equal(touchControls.inside,true,'Wrapped touch controls stay inside the composer');assert.ok(touchControls.height<=90,'The three controls fit within two touch rows on a 320px phone');assert.ok(touchControls.targets.every(target=>target.height>=44),'All wrapped selectors keep touchable rows');
 await page.screenshot({path:'/tmp/revline-composer-reasoning-speed-mobile.png'});console.log(JSON.stringify({touchControls}));
 assert.deepEqual(errors,[]);
 console.log('PASS: compact model/reasoning/speed controls preserve backend defaults; OpenAI effort choices reach typed and suggested requests, stay locked while busy, and fit the narrow composer. Stale Claude choices are hidden and hidden selectors omit overrides. Synthetic fixture only.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
