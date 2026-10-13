import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
const bundled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {AssistantPanel} from './components/editor/assistant-panel';import {chatMessageKey,chatToolFromPart} from './components/editor/assistant-results';const root=createRoot(document.getElementById('root'));window.renderMessages=raw=>{const messages=raw.map(m=>({...m,id:chatMessageKey(m),steps:m.steps??m.parts?.map(chatToolFromPart).filter(Boolean)}));flushSync(()=>root.render(<AssistantPanel messages={messages} running={messages.some(m=>m.status==='streaming')} configured={true} onSend={async()=>{}} hasClips={true} demo={false}/>));};`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,outdir:'/tmp/revline-chat-stream-smoke',define:{'process.env.NODE_ENV':'"production"'}});
const script=bundled.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundled.outputFiles.find(file=>file.path.endsWith('.css')).text;
// Isolated loopback demo: actual chat components/styles, synthetic SDK events,
// and no credentials, Convex connection, or access to an existing project.
const editorCss=await readFile(new URL('../app/editor.css',import.meta.url),'utf8');
const sharedCss=await readFile(new URL('../components/workspace/shared.css',import.meta.url),'utf8');
const shell='<title>Chat streaming verification</title><link rel="stylesheet" href="/demo.css"><main class="conversation-editor"><div id="root"></div></main><script src="/renderer.js"></script>';
const demoCss=`${editorCss}\n${sharedCss}\n${css}\n:root{--background:#191a1b;--foreground:#f0f0ee;--card:#191a1b;--border:#353739;--muted-foreground:#a1a3a5;--primary:#f0f0ee;--secondary:#252628;--ws-bg:#191a1b;--ws-text:#f0f0ee;--ws-muted:#a1a3a5;--ws-surface:#252628;--ws-hover:#303234}*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font-family:Arial,sans-serif}main{width:440px;height:740px;margin:32px auto;padding:16px;display:flex}#root{display:flex;flex:1;min-width:0}button,textarea{font:inherit;color:inherit}button{cursor:pointer}p{margin:0}.space-y-3\\.5>*+*{margin-top:14px}.font-semibold{font-weight:600}`;
const server=createServer((request,response)=>{
 const path=new URL(request.url,'http://127.0.0.1').pathname;
 const asset=path==='/renderer.js'?['text/javascript',script]:path==='/demo.css'?['text/css',demoCss]:path==='/editor/demo'?['text/html',shell]:null;
 response.writeHead(asset?200:404,{'Content-Type':asset?.[0]??'text/plain'});response.end(asset?.[1]??'Not found');
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
let browser;
const messages=(text,status)=>[{id:'question',role:'user',text:'Cut this clip'},{id:status==='streaming'?'temporary-stream-id':'persisted-id',key:'answer',role:'assistant',text,status}];
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewport({width:1000,height:820});
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
 await page.goto(`http://127.0.0.1:${server.address().port}/editor/demo`,{waitUntil:'networkidle0'});
 await page.evaluate(messages=>window.renderMessages(messages),messages('Your edit','streaming'));
 assert.equal(await page.$eval('[data-message-id="answer"] [data-flow-token]',el=>getComputedStyle(el).animationName),'ft-fadeIn');
 assert.deepEqual(await page.$eval('[data-message-id="answer"] [data-flow-token]',el=>({duration:getComputedStyle(el).animationDuration,timing:getComputedStyle(el).animationTimingFunction})),{duration:'0.6s',timing:'ease-in-out'});
 await page.evaluate(()=>{window.firstToken=document.querySelector('[data-message-id="answer"] [data-flow-token]');window.firstAnimation=window.firstToken.getAnimations()[0];});
 await new Promise(resolve=>setTimeout(resolve,85));
 assert.ok(await page.$eval('[data-message-id="answer"] [data-flow-token]',el=>{const opacity=Number(getComputedStyle(el).opacity);return opacity>0&&opacity<1;}),'Live text visibly fades through partial opacity');
 await page.evaluate(messages=>window.renderMessages(messages),messages('Your edit is','streaming'));
 assert.equal(await page.evaluate(()=>window.firstToken===document.querySelector('[data-message-id="answer"] [data-flow-token]')),true,'Appending text preserves token identity');
 assert.equal(await page.evaluate(()=>window.firstAnimation===window.firstToken.getAnimations()[0]),true,'Existing token fade is not restarted');
 await new Promise(resolve=>setTimeout(resolve,210));
 await page.evaluate(messages=>window.renderMessages(messages),messages('Your edit is ready.','success'));
 assert.equal(await page.evaluate(()=>window.firstToken===document.querySelector('[data-message-id="answer"] [data-flow-token]')),true,'Stream to persisted ID handoff preserves token DOM');
 assert.equal(await page.$eval('[data-message-id="answer"] [data-flow-token]:last-child',el=>getComputedStyle(el).animationName),'ft-fadeIn','Incoming chunk must finish its fade when the stream settles');
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-flow-token]')].every(el=>getComputedStyle(el).opacity==='1'));
 await page.evaluate(messages=>window.renderMessages(messages),messages('Your edit is ready. Play it now.','success'));
 assert.equal(await page.evaluate(()=>window.firstToken===document.querySelector('[data-message-id="answer"] [data-flow-token]')),true,'A normalized persisted response retains its unchanged prefix');
 await page.evaluate(()=>window.renderMessages([{id:'history',role:'assistant',text:'Previously saved response',status:'success'}]));
 assert.equal(await page.$eval('[data-message-id="history"] [data-flow-token]',el=>getComputedStyle(el).animationName),'none','Historical messages must not replay');
 await page.evaluate(()=>{window.historyToken=document.querySelector('[data-message-id="history"] [data-flow-token]');window.renderMessages([{id:'history',role:'assistant',text:'Previously saved response continues.',status:'streaming'}]);});
 assert.equal(await page.evaluate(()=>window.historyToken===document.querySelector('[data-message-id="history"] [data-flow-token]')),true);
 assert.equal(await page.$eval('[data-message-id="history"] [data-flow-token]',el=>getComputedStyle(el).animationName),'none','Existing snapshot stays still when a live stream resumes');
 assert.equal(await page.$eval('[data-message-id="history"] [data-flow-token]:last-child',el=>getComputedStyle(el).animationName),'ft-fadeIn','Only the newly received tail fades');
 await page.evaluate(()=>window.renderMessages([{id:'bold',role:'assistant',text:'**Ready',status:'streaming'}]));
 await page.evaluate(()=>window.boldToken=document.querySelector('[data-message-id="bold"] [data-flow-token]'));
 await page.evaluate(()=>window.renderMessages([{id:'bold',role:'assistant',text:'**Ready**',status:'streaming'}]));
 assert.equal(await page.evaluate(()=>window.boldToken===document.querySelector('[data-message-id="bold"] [data-flow-token]')),true,'Finishing bold markup must not remount its paragraph as a heading');
 await page.evaluate(()=>window.renderMessages([{id:'burst',role:'assistant',text:'A larger burst of text arrives together without holding the finished response in a long typewriter queue.',status:'streaming'}]));
 assert.equal(await page.$$eval('[data-flow-token]',nodes=>nodes.map(el=>el.textContent).join('')),'A larger burst of text arrives together without holding the finished response in a long typewriter queue.','Every received word is in the rendered reply immediately');
 assert.ok(await page.$$eval('[data-flow-token]',nodes=>nodes.every(el=>getComputedStyle(el).animationDelay==='0s')),'Every received word begins fading immediately, without artificial staggering');
 await new Promise(resolve=>setTimeout(resolve,85));
 assert.ok(await page.$$eval('[data-flow-token]',nodes=>nodes.every(el=>{const opacity=Number(getComputedStyle(el).opacity);return opacity>0&&opacity<1;})),'The full received burst fades together at partial opacity');
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-flow-token]')].every(el=>getComputedStyle(el).opacity==='1'),{timeout:1200});
 await page.evaluate(()=>window.renderMessages([{id:'cards',role:'assistant',text:'I will mark the beats.',status:'success',parts:[{type:'tool-markMusicBeats',toolCallId:'beat',state:'output-available',output:{added:23,saved:true}},{type:'tool-analyzeMedia',toolCallId:'failed',state:'output-available',output:{type:'error-text',value:'Shot detection failed'}}]}]));
 assert.equal(await page.$eval('.assistant-result-card.result-done',el=>el.textContent),'Marked 23 beats');
 assert.match(await page.$eval('.assistant-result-card.result-error',el=>el.textContent),/Could not finish.*Shot detection failed/);
 await page.evaluate(()=>window.renderMessages([{id:'evidence',role:'assistant',text:'The saved step is complete. The replacement is prepared.',status:'success',parts:[
  {type:'tool-markMusicBeats',toolCallId:'beat',state:'output-available',output:{added:23,saved:true}},
  {type:'tool-delete',toolCallId:'remove',state:'output-available',output:{removedClipIds:['v1','a1'],staged:true,saved:false}},
  {type:'tool-addSubtitlesFromTranscript',toolCallId:'captions',state:'output-available',output:{changedClips:[{id:'c1',kind:'caption'},{id:'c2',kind:'caption'}],staged:true,saved:false}},
  {type:'tool-trim',toolCallId:'unconfirmed',state:'output-available',output:{changedClips:[{id:'v1',kind:'video'}]}},
  {type:'tool-analyzeMedia',toolCallId:'failed-transcript',state:'output-available',output:{type:'error-json',value:{message:'Transcription failed'}}},
  {type:'tool-analyzeMedia',toolCallId:'failed-shots',state:'output-error',errorText:'Shot detection failed'}
 ]}]));
 assert.deepEqual(await page.$$eval('.assistant-result-card',cards=>cards.map(card=>card.textContent)),['Marked 23 beats','Prepared: Removed 2 clipsAwaiting save','Prepared: Added 2 subtitlesAwaiting save','Save not confirmedThis step did not confirm a saved change.','Could not finish this stepTranscription failed','Could not finish this stepShot detection failed']);
 assert.ok(await page.$$eval('.assistant-result-card',cards=>cards.every(card=>card.scrollWidth<=card.clientWidth)),'Result cards fit the chat column');
 const screenshot=process.env.REVLINE_CHAT_SCREENSHOT??'/tmp/revline-chat-streaming.png';
 await page.screenshot({path:screenshot});
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 await page.evaluate(()=>window.renderMessages([{id:'default-reduced',role:'assistant',text:'New replies fade by default',status:'streaming'}]));
 assert.equal(await page.$('select[aria-label="Reply text appearance"]'),null,'Reply animation has no preference control');
 await new Promise(resolve=>setTimeout(resolve,85));
 assert.ok(await page.$eval('[data-flow-token]',el=>{const opacity=Number(getComputedStyle(el).opacity);return opacity>0&&opacity<1;}),'Default text fade remains visible when Ubuntu requests reduced motion');
 await page.evaluate(()=>localStorage.setItem('revline:reply-text-appearance:v1','instant'));
 await page.reload({waitUntil:'networkidle0'});
 await page.evaluate(()=>window.renderMessages([{id:'always-fade',role:'assistant',text:'New replies fade immediately',status:'streaming'}]));
 assert.equal(await page.$eval('[data-flow-token]',el=>getComputedStyle(el).animationName),'ft-fadeIn','Old saved preferences cannot disable the default fade');
 assert.ok(await page.$$eval('[data-flow-token]',nodes=>nodes.every(el=>getComputedStyle(el).animationDelay==='0s')),'Default fade adds no reply delay');
 assert.deepEqual(errors,[],'No browser runtime errors');
 console.log(`PASS: loopback demo, varied transport bursts, stable stream/persisted identity, unchanged emphasis nodes, final fades, immediate complete bursts with zero animation delay, immediate history, verified/staged result cards, visible failures, default fades with reduced motion, no preference controls and obsolete preferences ignored. Screenshot: ${screenshot}`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
