import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// This fixture has no Clerk, Convex, project connection, or external media.
// Real chat components receive synthetic saved snapshots and SDK tool events.
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { AssistantPanel } from './components/editor/assistant-panel';
    import { matchesUndoSnapshot } from './components/editor/assistant-results';
    import { createEditorStore } from './lib/editor/store';
    import { normalizeTimeline } from './lib/editor/types';
    const before = normalizeTimeline({fps:30,aspectRatio:'landscape',clips:[{id:'original',assetId:'fixture-video',kind:'video',track:1,start:0,duration:12,sourceStart:0}],tracks:{visual:1,overlay:0,audio:0,effects:0}});
    const after = normalizeTimeline({...before,tracks:{visual:2,overlay:0,audio:0,effects:0},clips:[{id:'opening',assetId:'fixture-video',kind:'video',track:1,start:0,duration:4,sourceStart:0},{id:'ending',assetId:'fixture-video',kind:'video',track:1,start:4,duration:6,sourceStart:6},{id:'subtitle',kind:'caption',track:2,start:0,duration:10,sourceStart:0,text:'A saved caption',animation:'rise'}]});
    const request = {id:'request',role:'user',text:'Remove this section and add animated captions.'};
    const tools = [{id:'trim',name:'trim',state:'done',staged:true,output:{saved:false,staged:true,revision:10,changedClips:after.clips.slice(0,2)}},{id:'captions',name:'addCaption',state:'done',staged:true,output:{saved:false,staged:true,revision:10,changedClips:[after.clips[2]]}}];
    const response = {id:'answer',role:'assistant',text:'Removed the section and added animated captions.',status:'success',steps:tools};
    const root = createRoot(document.getElementById('root'));
    let store, state, resolveSend, resolveStop, mount=0;
    window.requests = []; window.attachCount = 0;window.delayUser=false;window.pendingRequest=null;window.stopCount=0;window.rejectSend=false;
    const render = () => flushSync(() => root.render(<AssistantPanel key={mount} {...state} configured hasClips demo={false} onAttach={() => window.attachCount++} onSend={async text => {if(window.rejectSend)throw new Error('The request could not be sent.');window.requests.push(text);window.pendingRequest={id:'new-request',role:'user',text};if(!window.delayUser){state={...state,messages:[...state.messages,window.pendingRequest],editSnapshot:undefined};render();}await new Promise(resolve => resolveSend=resolve);} } onStop={async()=>{window.stopCount++;await new Promise(resolve=>resolveStop=resolve);state={...state,running:false,activity:null,messages:state.messages.map(message=>message.id==='tool-pass'?{...message,status:'aborted',steps:message.steps.map(step=>({...step,state:'error',detail:'Stopped by you.'}))}:message)};render();}}/>));
    window.resetFixture = () => {mount++;store=createEditorStore(before);store.getState().replace(after,true);state={messages:[request,response],running:false,error:null,editSnapshot:{before,after,revision:11,publishedDraft:true,canUndo:true}};render();};
    window.updateFixture = patch => {state={...state,...patch};render();};
    window.finishSend = () => resolveSend?.();window.finishStop=()=>resolveStop?.();window.acceptRequest=()=>{state={...state,messages:[...state.messages,window.pendingRequest],editSnapshot:undefined};render();};
    window.fixtureState = () => ({timeline:store.getState().timeline,before,after,snapshot:state.editSnapshot,messages:state.messages,tools});
    window.manualEdit = () => {store.getState().edit({...after,clips:after.clips.map(clip=>clip.id==='opening'?{...clip,volume:.4}:clip)});state={...state,editSnapshot:{...state.editSnapshot,canUndo:matchesUndoSnapshot(state.editSnapshot,store.getState().timeline,store.getState().history.at(-1))}};render();};
    window.resetFixture();
  ` },
  bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', write: false,
  outdir: '/tmp/revline-assistant-edit-smoke', define: { 'process.env.NODE_ENV': '"production"' },
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const [editorCss, sharedCss] = await Promise.all([
  readFile(new URL('../app/editor.css', import.meta.url), 'utf8'),
  readFile(new URL('../components/workspace/shared.css', import.meta.url), 'utf8'),
]);
const styles = `${editorCss}\n${sharedCss}\n${css}\n
  :root{--background:#111;--foreground:#f0f0ee;--card:#111;--border:#35353b;--ring:#5474f8;--muted-foreground:#97979f;--primary:#f0f0ee;--secondary:#242426;--ws-bg:#111;--ws-text:#f0f0ee;--ws-muted:#97979f;--ws-surface:#242426;--ws-hover:#303234}
  :root.light{--background:#fafafa;--foreground:#202124;--card:#fafafa;--border:#dedfe3;--muted-foreground:#71757b;--primary:#202124;--secondary:#eeeef1;--ws-bg:#fafafa;--ws-text:#202124;--ws-muted:#71757b;--ws-surface:#eeeef1;--ws-hover:#e5e5eb}
  *{box-sizing:border-box}body{margin:0;background:#29292c;color:var(--foreground);font-family:Arial,sans-serif}main{width:400px;height:544px;margin:24px auto;background:var(--background);display:flex}.conversation-editor .editor-sidebar{width:400px;height:100%;display:flex;flex-direction:column;padding:16px 16px 12px}#root{display:flex;flex:1;min-width:0;min-height:0}button,textarea{font:inherit;color:inherit}button{cursor:pointer}p{margin:0}.font-semibold{font-weight:600}.space-y-3\\.5>*+*{margin-top:14px}
`;
const shell = '<!doctype html><title>Isolated edit summary verification</title><link rel="stylesheet" href="/fixture.css"><main class="conversation-editor"><section class="editor-sidebar"><div id="root"></div></section></main><script src="/fixture.js"></script>';
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const asset = path === '/fixture.js' ? ['text/javascript', script] : path === '/fixture.css' ? ['text/css', styles] : path === '/fixture' ? ['text/html', shell] : null;
  response.writeHead(asset ? 200 : 404, { 'Content-Type': asset?.[0] ?? 'text/plain' });
  response.end(asset?.[1] ?? 'Not found');
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1200, height: 620 });
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: 'networkidle0' });
  {
    const failures=[];
    const check=async(label,probe)=>{try{await probe();}catch{failures.push(label);}};
    await page.evaluate(()=>{window.updateFixture({messages:window.fixtureState().messages.map(({steps,...message})=>message),editSnapshot:undefined});window.delayUser=true;window.oldAnswer=document.querySelector('[data-message-id="answer"]');window.oldHeader=document.querySelector('[data-turn-id="request"] .chat-author');});
    await page.type('textarea','Make the next shot shorter.');await page.click('[aria-label="Start edit"]');
    await check('Follow-up does not restart the previous loading row',async()=>assert.equal(await page.$('[data-turn-id="request"] .processing-status[data-state="working"]'),null));
    await check('Historical reply keeps its header and answer DOM',async()=>assert.equal(await page.evaluate(()=>document.querySelector('[data-turn-id="request"] .chat-author')===window.oldHeader&&document.querySelector('[data-message-id="answer"]')===window.oldAnswer),true));
    await check('New request appears immediately',async()=>assert.equal(await page.$$eval('.chat-user',nodes=>nodes.at(-1)?.textContent),'Make the next shot shorter.'));
    await page.evaluate(()=>{window.updateFixture({running:true});window.finishSend();});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await check('Running-before-message handoff stays on the new request',async()=>assert.equal(await page.$('[data-turn-id="request"] .processing-status[data-state="working"]'),null));
    await check('Optimistic request survives the SDK handoff',async()=>assert.equal(await page.$$eval('.chat-user',nodes=>nodes.at(-1)?.textContent),'Make the next shot shorter.'));
    await (await page.$('main')).screenshot({path:'/tmp/revline-assistant-follow-up-waiting.png'});
    await page.evaluate(()=>window.acceptRequest());
    await check('Server request replaces optimistic request without duplication',async()=>assert.equal(await page.$$eval('.chat-user',nodes=>nodes.filter(node=>node.textContent==='Make the next shot shorter.').length),1));
    await check('A new empty reply retains activity feedback',async()=>assert.ok(await page.$('[data-turn-id="new-request"] .processing-status-sweep')));
    await page.evaluate(()=>window.updateFixture({messages:[...window.fixtureState().messages,{id:'new-answer',role:'assistant',text:'I’m tightening that shot.',status:'streaming'}]}));
    await check('First streamed text hides the loading beam',async()=>assert.equal(await page.$('[data-turn-id="new-request"] .processing-status-sweep'),null));
    await page.evaluate(()=>window.updateFixture({activity:'Listening…',activitySource:'Synthetic footage',activityProgress:87}));
    await check('A transcription request resumes working feedback after its spoken preamble',async()=>assert.ok(await page.$('[data-turn-id="new-request"] .processing-status-sweep')));
    await new Promise(resolve=>setTimeout(resolve,700));await (await page.$('main')).screenshot({path:'/tmp/revline-assistant-follow-up-streaming.png'});
    await page.evaluate(()=>window.updateFixture({activity:null,activitySource:null,messages:window.fixtureState().messages.map(message=>message.id==='new-answer'?{...message,status:'success'}:message)}));
    await check('Final reply does not reflash the beam while running catches up',async()=>assert.equal(await page.$('[data-turn-id="new-request"] .processing-status-sweep'),null));
    await page.evaluate(()=>window.updateFixture({messages:window.fixtureState().messages.concat({id:'tool-pass',role:'assistant',text:'',status:'streaming',steps:[{id:'cut',name:'trim',state:'running'}]})}));
    await check('Tools retain activity feedback without active text',async()=>assert.ok(await page.$('[data-turn-id="new-request"] .processing-status-sweep')));
    await check('The prior completed answer remains historical',async()=>assert.equal(await page.evaluate(()=>document.querySelector('[data-message-id="answer"]')===window.oldAnswer),true));
    await page.evaluate(()=>window.updateFixture({messages:window.fixtureState().messages.filter(message=>message.id!=='tool-pass').map(message=>message.id==='new-answer'?{...message,status:'streaming',steps:[{id:'transcribe',name:'analyzeMedia',state:'running'}]}:message)}));
    await check('A tool in the same text message also resumes working feedback',async()=>assert.ok(await page.$('[data-turn-id="new-request"] .processing-status-sweep')));
    await check('Analysis activity has no invented percentage',async()=>assert.equal(await page.$('.processing-status-measured'),null));
    await new Promise(resolve=>setTimeout(resolve,700));await (await page.$('main')).screenshot({path:'/tmp/revline-assistant-turn-tool.png'});
    await page.click('[aria-label="Stop editing"]');await page.waitForFunction(()=>document.querySelector('.processing-status-label')?.textContent==='Stopping…');
    await page.evaluate(()=>window.finishStop());await page.waitForFunction(()=>[...document.querySelectorAll('.processing-status-label')].some(node=>node.textContent==='Stopped.'));
    await check('Stopping keeps historical text intact',async()=>assert.equal(await page.evaluate(()=>document.querySelector('[data-message-id="answer"]')===window.oldAnswer&&window.stopCount===1),true));
    await check('Stopped work has no live loading beam',async()=>assert.equal(await page.$('.processing-status-sweep'),null));
    await page.evaluate(()=>window.rejectSend=true);await page.type('textarea','Try this follow-up again.');await page.click('[aria-label="Start edit"]');await page.waitForFunction(()=>document.querySelector('.chat-error .processing-status-detail')?.textContent==='The request could not be sent.');
    await check('A rejected send preserves the historical answer',async()=>assert.equal(await page.evaluate(()=>document.querySelector('[data-message-id="answer"]')===window.oldAnswer),true));
    await check('A rejected send clears its optimistic loading state',async()=>assert.equal(await page.$('.assistant-reply-header.is-processing'),null));
    await check('A rejected send keeps the prompt for retry',async()=>assert.equal(await page.$eval('textarea',node=>node.value),'Try this follow-up again.'));
    await page.evaluate(()=>window.rejectSend=false);
    assert.deepEqual(failures,[]);assert.deepEqual(errors,[]);console.log('PASS: actual AssistantPanel delayed follow-up and SDK handoff preserve historical replies, replace the optimistic request once, hide the beam with streamed/final text, retain tool activity without invented percentages, and handle stopping and rejected sends.');
  }
  if (!process.argv.includes('--turn-regression')) {
  await page.evaluate(()=>{window.delayUser=false;window.requests=[];window.resetFixture();});
  assert.equal(await page.$('.assistant-panel-header'), null, 'Chat has no extra navbar');
  assert.equal(await page.$('[aria-label="View chat history"]'),null);
  assert.equal(await page.$('[aria-label="New conversation"]'),null);
  assert.deepEqual(await page.$$eval('.assistant-result-card', nodes => nodes.map(node => node.textContent)), ['Trimmed 2 clips', 'Added 1 subtitle']);
  assert.equal(await page.$('.assistant-edit-comparison'),null,'Before/After comparison is removed');
  assert.equal(await page.$eval('textarea', element => element.placeholder), 'What would you change next?');
  assert.equal(await page.$('.assistant-undo-edit'), null, 'Undo is only in the editor toolbar');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('Review changes') || document.body.textContent.includes('Pause') || document.body.textContent.includes('2 changes applied')), false, 'No mock edits or obsolete review action');
  const bounds = await page.evaluate(() => {
    const shell = document.querySelector('main').getBoundingClientRect(), composer = document.querySelector('.edit-composer').getBoundingClientRect();
    return { height: composer.height, bottom: shell.bottom - composer.bottom, overflows: [...document.querySelectorAll('.assistant-panel-header,.chat-user,.assistant-result-card,.assistant-edit-comparison,.edit-composer')].some(element => element.scrollWidth > element.clientWidth) };
  });
  assert.ok(bounds.height >= 80 && bounds.height <= 88, `Compact composer is ${bounds.height}px`);
  assert.equal(bounds.bottom, 12, 'Composer stays at the bottom of the full-height chat');
  assert.equal(bounds.overflows, false);
  await page.screenshot({ path: '/tmp/revline-assistant-edit-dark.png' });
  await page.evaluate(() => document.documentElement.classList.add('light'));
  await page.screenshot({ path: '/tmp/revline-assistant-edit-light.png' });
  await page.evaluate(() => document.documentElement.classList.remove('light'));

  await page.evaluate(() => { window.resetFixture(); window.manualEdit(); });
  assert.equal(await page.$('.assistant-undo-edit'), null, 'Manual edits do not bring chat Undo back');

  await page.evaluate(() => { window.resetFixture(); window.updateFixture({editSnapshot:undefined}); });
  assert.equal(await page.$('.assistant-edit-comparison'), null, 'Unpublished tools cannot claim a saved comparison');
  assert.match(await page.$eval('.assistant-result-card', element => element.textContent), /Prepared:.*Awaiting save/);
  await page.evaluate(() => window.updateFixture({error:'Replacement failed'}));
  assert.equal(await page.$('.assistant-undo-edit'), null);
  assert.match(await page.$eval('.assistant-result-card', element => element.textContent), /Not saved:.*was not saved/);

  await page.evaluate(() => { window.resetFixture(); window.updateFixture({messages:[],editSnapshot:undefined}); });
  await page.click('[aria-label="Add footage"]');
  assert.equal(await page.evaluate(() => window.attachCount), 1);
  await page.type('textarea', 'Tighten this opening');
  await page.click('[aria-label="Start edit"]');
  await page.waitForSelector('.processing-status');
  assert.equal(await page.$eval('.assistant-reply-header > .revline-brand', element => !!element.querySelector('.revline-mark')), true, 'Brand appears before the first assistant event');
  assert.equal(await page.$eval('.processing-status-label', element => element.textContent), 'Editing…');
  await page.evaluate(() => { window.brand = document.querySelector('.assistant-reply-header > .revline-brand'); window.finishSend(); });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(await page.evaluate(() => document.querySelector('.assistant-reply-header > .revline-brand') === window.brand), true, 'The send/SDK handoff retains the pending header');
  assert.equal(await page.$eval('.processing-status-label', element => element.textContent), 'Editing…');
  await page.evaluate(() => window.updateFixture({running:true,messages:[window.fixtureState().messages[0],{id:'live-answer',role:'assistant',text:'Tightened the',status:'streaming'}]}));
  assert.equal(await page.evaluate(() => document.querySelector('.assistant-reply-header > .revline-brand') === window.brand), true);
  await page.evaluate(() => window.token = document.querySelector('[data-flow-token]'));
  await page.evaluate(() => window.updateFixture({messages:[window.fixtureState().messages[0],{id:'live-answer',role:'assistant',text:'Tightened the opening.',status:'streaming'}]}));
  assert.equal(await page.evaluate(() => window.token === document.querySelector('[data-flow-token]')), true);
  await page.evaluate(() => window.updateFixture({running:false,messages:[window.fixtureState().messages[0],{id:'live-answer',role:'assistant',text:'Tightened the opening.',status:'success'}]}));
  assert.equal(await page.evaluate(() => window.token === document.querySelector('[data-flow-token]')), true);
  assert.equal(await page.$$eval('.chat-author', elements => elements.length), 1, 'No duplicate brand after streaming completes');
  assert.equal(await page.evaluate(() => window.requests[0]), 'Tighten this opening');

  await page.setViewport({ width: 1200, height: 960 });
  await page.evaluate(() => { document.querySelector('main').style.height='900px';window.resetFixture(); });
  assert.equal(await page.evaluate(() => document.querySelector('main').getBoundingClientRect().bottom-document.querySelector('.edit-composer').getBoundingClientRect().bottom), 12, 'Long chat retains a bottom composer');
  await page.screenshot({ path: '/tmp/revline-assistant-edit-tall.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: truthful saved result summaries, compact dark/light layout without Before/After, chat Undo or extra navbar, staged/error results truthful, immediate brand and stable pending/streaming handoff. Screenshots: /tmp/revline-assistant-edit-{dark,light,tall}.png');
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
