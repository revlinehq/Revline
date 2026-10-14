import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// Actual inspector, timeline drop handler, and undo store; no project or provider calls.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {PreviewInspector} from './components/editor/preview-inspector';import {TimelinePanel} from './components/editor/timeline';
import {EditorStateProvider,useEditorState} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';
import {patchClip,deleteClip} from './lib/editor/operations';import {copyTimelineClips,pasteTimelineClips} from './lib/editor/clipboard';import {placeTransitionAt} from './lib/editor/transition-placement';import {TooltipProvider} from './components/ui/tooltip';
import './components/workspace/workspace-pages.css';import './app/editor.css';
const initial={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:1,effects:0},clips:[
{id:'a',kind:'image',assetId:'a',start:0,duration:3,sourceStart:0,track:1},
{id:'b',kind:'image',assetId:'b',start:3,duration:3,sourceStart:1,track:1},
{id:'c',kind:'image',assetId:'c',start:6,duration:3,sourceStart:2,track:1},
{id:'isolated',kind:'image',assetId:'a',start:1,duration:2,sourceStart:0,track:2},
{id:'music',kind:'audio',assetId:'music',start:0,duration:9,sourceStart:4,volume:.8,track:1}]};
const colors=['#c94747','#4779c9','#44a775'];const assets=['a','b','c'].map((id,index)=>({_id:id,kind:'image',fileName:['First shot.png','Second shot.png','Third shot.png'][index],width:320,height:180,url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="'+colors[index]+'"/></svg>')}));
assets.push({_id:'music',kind:'audio',fileName:'Score.m4a',duration:30});const store=createEditorStore(initial);store.setState({selectedId:'a',selectedIds:['a'],playhead:3});
window.next=0;window.transitionErrors=[];window.drafts=[];
function Fixture(){const timeline=useEditorState(state=>state.timeline),selected=useEditorState(state=>state.selectedId),time=useEditorState(state=>state.playhead),[editRequest,setEditRequest]=useState(0),[clipboard,setClipboard]=useState([]);const clip=timeline.clips.find(item=>item.id===selected);
const select=id=>{store.setState({selectedId:id,selectedIds:id?[id]:[]});setEditRequest(value=>value+1)};window.fixture={timeline,history:store.getState().history.length,selected,select,reset:()=>{store.getState().recover(initial);store.setState({playhead:3});select('a')},incompatible:()=>{store.getState().recover({...initial,clips:initial.clips.map(clip=>clip.id==='b'?{...clip,blendMode:'multiply'}:clip)});store.setState({playhead:3});select('a')},uncut:()=>{store.getState().recover({...initial,clips:[{...initial.clips[0],duration:9},initial.clips.at(-1)]});store.setState({playhead:4});select('a')},short:()=>{store.getState().recover({...initial,clips:[{...initial.clips[0],duration:1/30},{...initial.clips[1],start:1/30,duration:1/30}]});store.setState({playhead:1/30});select('a')}};
return <TooltipProvider><div className="fixture-toolbar"><button id="undo" onClick={()=>store.getState().undo()}>Undo</button><button id="redo" onClick={()=>store.getState().redo()}>Redo</button></div><div className="fixture-inspector"><PreviewInspector timeline={timeline} time={time} editRequest={editRequest} clip={clip} assets={assets} asset={assets.find(asset=>asset._id===clip?.assetId)} upload={null} onUpload={()=>{}} onAdd={()=>{}} onCrop={()=>{}} onChange={patch=>store.getState().edit(patchClip(timeline,selected,patch))} onPreviewEffects={patch=>window.drafts.push(patch)} onAddTransition={preset=>{const id='fx-'+(++window.next);store.getState().edit(placeTransitionAt(timeline,id,preset,store.getState().playhead,{aboveClipId:clip?.kind==='video'||clip?.kind==='image'?clip.id:undefined}));store.setState({selectedId:id,selectedIds:[id]})}}/></div><div className="fixture-timeline"><TimelinePanel timeline={timeline} assets={assets} selected={selected} onSelect={select} time={time} playing={false} onSeek={()=>{}} onChange={next=>store.getState().edit(next)} onSplit={()=>{}} onDelete={()=>store.getState().edit(deleteClip(timeline,store.getState().selectedId))} onDuplicate={()=>{}} onCopy={()=>setClipboard(copyTimelineClips(timeline,store.getState().selectedIds))} onPaste={(at,visualTrack)=>store.getState().edit(pasteTimelineClips(timeline,clipboard,at,undefined,{visualTrack}).timeline)} canPaste={!!clipboard.length} onEditClip={select} onAddText={()=>{}} onError={message=>window.transitionErrors.push(message)}/></div></TooltipProvider>};
createRoot(document.getElementById('root')).render(<EditorStateProvider store={store}><Fixture/></EditorStateProvider>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-transition-ui-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const html='<html data-workspace-theme="dark"><style>'+css+'*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font:12px Arial}button{border:0;font-family:inherit}#root{display:grid;grid-template-columns:480px minmax(0,1fr);gap:20px;padding:20px;height:800px}.fixture-toolbar{grid-column:1 / -1;display:flex;gap:16px;height:30px}.fixture-inspector{height:700px;min-width:0}.fixture-timeline{min-width:0}.fixture-timeline .timeline-panel{height:400px}</style><div id="root" class="conversation-editor"></div><script src="/fixture.js"></script></html>';
const server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':request.url==='/fixture.js'?'text/javascript':'text/html'});response.end(request.url==='/fixture.js'?js:html)});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=768']});const page=await browser.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:1120,height:820});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.effect-library');
 const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const button=name=>page.locator('::-p-aria([name="'+name+'"][role="button"])');
 const library=async()=>{await page.click('#inspector-tools-tab');await page.click('[data-category="transitions"]');await flush()};
 const addAt3='[aria-label="Add transition at 3.00s"]',addAt6='[aria-label="Add transition at 6.00s"]';
 await page.hover('.timeline-track[data-group=visual][data-layer="1"]');await flush();
 assert.equal(await page.$eval(addAt3,node=>getComputedStyle(node).opacity),'0','Hovering a track does not reveal all pluses');
 await page.hover(addAt3);await flush();
 assert.equal(await page.$eval(addAt3,node=>getComputedStyle(node).opacity),'1','Only the nearby cut plus appears');
 assert.equal(await page.$eval(addAt6,node=>getComputedStyle(node).opacity),'0','Other cut pluses stay hidden');
 for(const theme of ['dark','light']){await page.evaluate(theme=>document.documentElement.dataset.workspaceTheme=theme,theme);await flush();
  const style=await page.$eval(addAt3,node=>{const s=getComputedStyle(node);return {background:s.backgroundColor,border:s.borderTopWidth,shadow:s.boxShadow,stroke:node.querySelector('svg').getAttribute('stroke-width'),width:s.width}});
  assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.border,'0px');assert.equal(style.shadow,'none');assert.equal(style.stroke,'3');assert.equal(style.width,'24px','Bare plus keeps its click target');
 }
 await page.evaluate(()=>document.documentElement.dataset.workspaceTheme='dark');await page.mouse.move(5,5);await flush();
 assert.equal(await page.$eval(addAt3,node=>getComputedStyle(node).opacity),'0','Plus hides again after leaving the cut');
 await page.keyboard.press('Tab');await page.focus(addAt3);await flush();
 assert.equal(await page.$eval(addAt3,node=>getComputedStyle(node).opacity),'1','Keyboard focus reveals the plus');
 const sourceClips=await page.evaluate(()=>window.fixture.timeline.clips.filter(clip=>clip.kind!=='effect'));
 assert.ok(await page.$('[data-category="transitions"]'),'Working clip-to-clip transitions have a real category');
 await library();assert.deepEqual(await page.$$eval('.library-look',nodes=>nodes.map(node=>node.getAttribute('aria-label'))),['Crossfade','Spin zoom','Blur dissolve']);
 await page.screenshot({path:'/tmp/revline-transition-library.png',clip:{x:20,y:70,width:480,height:400}});
 const glyphs=await page.$$eval('.library-look svg:first-child',nodes=>nodes.map(node=>node.innerHTML));assert.equal(new Set(glyphs).size,3,'Each transition has a distinct vector icon');
 await button('Crossfade').click();await page.waitForSelector('[aria-label="Crossfade transition settings"]');let fx=await page.evaluate(()=>window.fixture.timeline.clips.find(clip=>clip.id===window.fixture.selected));assert.equal(fx.effectPreset,'crossfade');assert.deepEqual(fx.transition,{fromClipId:'a',toClipId:'b',direction:'clockwise'});assert.equal(fx.start,2.7);assert.equal(fx.duration,.6);assert.equal(await page.$('[aria-label="Transition direction"]'),null,'Crossfade has no meaningless direction control');assert.equal(await page.$('[aria-label="Blend mode"]'),null);
 assert.equal(await page.$('.timeline-track[data-group=effects]'),null,'A transition never occupies an FX row');
 assert.equal(await page.$('.timeline-clip[data-clip-id="'+fx.id+'"]'),null,'No separate transition FX block');
 assert.ok(await page.$('.timeline-track[data-group=visual][data-layer="1"] .timeline-cut-transition[data-clip-id="'+fx.id+'"]'),'Transition lives on its footage cut');
 await page.mouse.move(5,5);await page.evaluate(()=>document.activeElement.blur());await flush();
 assert.equal(await page.$eval('[aria-label="Crossfade at 3.00s"]',node=>getComputedStyle(node).opacity),'0','Existing transition icon hides when not hovered');
 assert.equal(await page.$eval('.timeline-transition-range',node=>getComputedStyle(node).opacity),'0','Existing transition range hides when not hovered');
 await page.hover('.timeline-track[data-group=visual][data-layer="1"]');await flush();
 assert.equal(await page.$eval('[aria-label="Crossfade at 3.00s"]',node=>getComputedStyle(node).opacity),'1','Hover reveals the transition');
 await page.mouse.move(5,5);await page.keyboard.press('Tab');await page.focus('[aria-label="Crossfade at 3.00s"]');await flush();
 assert.equal(await page.$eval('[aria-label="Crossfade at 3.00s"]',node=>getComputedStyle(node).opacity),'1','Keyboard focus reveals a hidden transition');
 const geometry=await page.$eval('[aria-label="Crossfade at 3.00s"]',node=>{const badge=node.getBoundingClientRect(),left=document.querySelector('[data-clip-id="a"]').getBoundingClientRect();return {center:badge.x+badge.width/2,cut:left.right}});assert.ok(Math.abs(geometry.center-geometry.cut)<1,'Badge is centered on the actual cut');
 const beforeKeyboard=await page.evaluate(()=>window.fixture.history);await page.focus('input[aria-label="Duration"]');await page.keyboard.press('ArrowRight');await flush();fx=await page.evaluate(()=>window.fixture.timeline.clips.find(clip=>clip.id===window.fixture.selected));assert.ok(Math.abs(fx.duration-.6333333333333333)<1e-6);assert.ok(Math.abs(fx.start+fx.duration/2-3)<1e-6);assert.equal(await page.evaluate(()=>window.fixture.history),beforeKeyboard+1,'One keyboard duration edit makes one undo step');
 const slider=await page.$('input[aria-label="Duration"]'),bounds=await slider.boundingBox(),beforeDrag=await page.evaluate(()=>window.fixture.history);await page.mouse.move(bounds.x+bounds.width*.3,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height/2);await flush();const draft=await page.evaluate(()=>window.drafts.filter(Boolean).at(-1));assert.ok(draft&&draft.duration&&Number.isFinite(draft.start));assert.ok(Math.abs(draft.start+draft.duration/2-3)<1e-6,'Live duration draft stays centered on the same cut');assert.equal(await page.evaluate(()=>window.fixture.history),beforeDrag,'Dragging previews without saving');await page.mouse.up();await flush();assert.equal(await page.evaluate(()=>window.fixture.history),beforeDrag+1);
 assert.deepEqual(await page.evaluate(()=>window.fixture.timeline.clips.filter(clip=>clip.kind!=='effect')),sourceClips,'Duration preserves source timing and the score');
 await page.click('#undo');await flush();assert.ok(Math.abs(await page.evaluate(()=>window.fixture.timeline.clips.find(clip=>clip.kind==='effect').duration)-.6333333333333333)<1e-6);await page.evaluate(()=>window.fixture.reset());await library();
 await button('Spin zoom').click();await page.waitForSelector('[aria-label="Spin zoom transition settings"]');
 const beforeDirection=await page.evaluate(()=>window.fixture.timeline.clips.find(clip=>clip.id===window.fixture.selected));await page.focus('[aria-label="Transition direction"]');await page.keyboard.press('Enter');await page.waitForSelector('[role="menuitemradio"]');assert.deepEqual(await page.$$eval('[role="menuitemradio"]',nodes=>nodes.map(node=>node.dataset.value)),['clockwise','counter-clockwise']);await page.keyboard.press('End');await flush();await page.keyboard.press('Enter');await flush();assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.find(clip=>clip.id===window.fixture.selected).transition.direction),'counter-clockwise');const afterDirection=await page.evaluate(()=>window.fixture.timeline.clips.find(clip=>clip.id===window.fixture.selected));assert.deepEqual({...afterDirection,transition:beforeDirection.transition},beforeDirection,'Direction changes preserve the actual pair and retained timing');await page.click('#undo');await flush();assert.equal(await page.$eval('[aria-label="Transition direction"]',node=>node.textContent),'Clockwise');assert.ok(await page.$eval('[aria-label="Connected clips"]',node=>node.textContent.includes('First shot.png')&&node.textContent.includes('Second shot.png')));await page.screenshot({path:'/tmp/revline-transition-spin-controls.png',clip:{x:20,y:70,width:480,height:400}});
 await page.evaluate(()=>window.fixture.reset());await page.evaluate(()=>window.fixture.select('isolated'));await library();assert.equal(await page.$eval('[aria-label="Blur dissolve"]',node=>node.getAttribute('aria-disabled')),'true');assert.ok(await page.$('.library-transition-availability'),'Unavailable additions explain the neighboring-pair requirement');const history=await page.evaluate(()=>window.fixture.history);await button('Blur dissolve').click();assert.equal(await page.evaluate(()=>window.fixture.history),history,'Unavailable + never writes');
 const drop=async(label,target,at=3)=>{await page.evaluate(({label,target,at})=>{const data=new DataTransfer(),row=document.querySelector('.library-look[aria-label="'+label+'"]');row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));const receiver=document.querySelector('[data-clip-id="'+target+'"]'),lane=receiver.closest('.timeline-track'),a=document.querySelector('[data-clip-id="a"]').getBoundingClientRect(),box=receiver.getBoundingClientRect();lane.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));receiver.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:a.left+a.width/window.fixture.timeline.clips.find(clip=>clip.id==='a').duration*at,clientY:box.top+10}));},{label,target,at});await flush()};
 await drop('Blur dissolve','a');fx=await page.evaluate(()=>window.fixture.timeline.clips.find(clip=>clip.effectPreset==='blur-dissolve'));assert.ok(fx,'A transition drag can target an eligible cut independently of the selection');assert.equal(fx.start,2.7,'Dropped transition snaps to the real cut');assert.equal(fx.duration,.6);assert.deepEqual(fx.transition,{fromClipId:'a',toClipId:'b',direction:'clockwise'});assert.deepEqual(await page.evaluate(()=>window.fixture.timeline.clips.filter(clip=>clip.kind!=='effect')),sourceClips);
 await page.evaluate(id=>window.fixture.select(id),fx.id);await page.waitForSelector('[aria-label="Blur dissolve transition settings"]');assert.equal(await page.$('[aria-label="Transition direction"]'),null,'Blur dissolve has no meaningless direction control');await page.evaluate(()=>window.fixture.select('isolated'));await library();
 const beforeRejected=await page.evaluate(()=>window.fixture.history);await drop('Spin zoom','isolated',3);assert.equal(await page.evaluate(()=>window.fixture.history),beforeRejected,'An ineligible dropped-on clip cannot connect other footage');assert.equal(await page.evaluate(()=>window.transitionErrors.length),0,'Invalid gesture targets are rejected without a runtime error');await page.click('#undo');await flush();assert.deepEqual(await page.evaluate(()=>window.fixture.timeline.clips),sourceClips,'Undo removes only the transition');

 await page.evaluate(()=>window.fixture.uncut());await library();
 assert.equal(await page.$eval('[aria-label="Crossfade"]',node=>node.draggable),true,'Unsplit footage allows transition dragging');
 const unsplit=await page.evaluate(()=>window.fixture.timeline);await drop('Spin zoom','a',4);
 let placed=await page.evaluate(()=>window.fixture.timeline);fx=placed.clips.find(clip=>clip.kind==='effect');
 assert.equal(placed.clips.filter(clip=>clip.kind==='image').length,2,'A middle drop splits the actual footage');
 assert.ok(Math.abs(fx.start+fx.duration/2-4)<1e-6,'The transition center is the dropped position');
 assert.equal(await page.evaluate(()=>window.fixture.history),1,'Cut and transition commit as one Undo');
 assert.deepEqual(placed.clips.find(clip=>clip.id==='music'),unsplit.clips.find(clip=>clip.id==='music'),'Independent audio stays untouched');
 const resizeTransition=async(cancel)=>{await page.hover('.timeline-track[data-group=visual][data-layer="1"]');await flush();
  const handle=await page.$('[aria-label="Resize Spin zoom end"]'),box=await handle.boundingBox();
  const px=await page.$eval('[data-clip-id="a"]',node=>node.getBoundingClientRect().width/4);
  await page.mouse.move(box.x+box.width-2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-2+.3*px,box.y+box.height/2,{steps:4});await flush();
  assert.equal(await page.evaluate(()=>window.fixture.history),1,'Resizing previews never saves intermediate drafts');
  if(cancel)await page.keyboard.press('Escape');await page.mouse.up();await flush();
 };
 await resizeTransition(true);assert.deepEqual(await page.evaluate(()=>window.fixture.timeline),placed,'Escape discards a duration draft');
 await resizeTransition(false);placed=await page.evaluate(()=>window.fixture.timeline);const resized=placed.clips.find(clip=>clip.id===fx.id);
 assert.ok(resized.duration>fx.duration,'Drag handles change duration');assert.ok(Math.abs(resized.start+resized.duration/2-4)<1e-6,'Duration stays centered on the cut');
 assert.equal(placed.clips.filter(clip=>clip.kind==='image').length,2);assert.equal(await page.evaluate(()=>window.fixture.history),2);
 await page.click('#undo');await flush();assert.ok(Math.abs(await page.evaluate(()=>window.fixture.timeline.clips.find(clip=>clip.kind==='effect').duration)-.6)<1e-6);
 await page.click('#undo');await flush();assert.deepEqual(await page.evaluate(()=>window.fixture.timeline),unsplit,'Undo restores the original uncut footage');
 // Add, replace, copy, paste, and remove at the cut itself.
 await page.evaluate(()=>window.fixture.reset());await flush();
 await page.focus('[aria-label="Add transition at 3.00s"]');await page.keyboard.press('Enter');await page.waitForSelector('[aria-label="Choose transition"]');
 assert.ok(await page.$$eval('.timeline-transition-menu [role="menuitem"]',nodes=>nodes.every(node=>getComputedStyle(node).cursor==='pointer')),'All transition choices have a pointer cursor');
 await page.hover('.timeline-transition-menu [role="menuitem"]');await flush();
 assert.ok(await page.$eval('.timeline-transition-menu [role="menuitem"][data-highlighted]',node=>getComputedStyle(node).backgroundColor!=='rgba(0, 0, 0, 0)'),'Hovered menu item has a visible background');
 await page.keyboard.press('ArrowDown');await flush();assert.ok(await page.$eval('.timeline-transition-menu [role="menuitem"][data-highlighted]',node=>getComputedStyle(node).backgroundColor!=='rgba(0, 0, 0, 0)'),'Keyboard choice has the same background highlight');
 await page.locator('::-p-aria([name="Crossfade"][role="menuitem"])').click();await flush();
 assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.filter(clip=>clip.kind==='effect').length),1);
 await page.click('[aria-label="Crossfade at 3.00s"]');await page.waitForSelector('[aria-label="Choose transition"]');
 await page.locator('::-p-aria([name="Blur dissolve"][role="menuitem"])').click();await flush();
 assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.filter(clip=>clip.kind==='effect').length),1,'Replace never stacks transitions');
 const badge=await page.$('[aria-label="Blur dissolve at 3.00s"]');await badge.click({button:'right'});await page.waitForSelector('[aria-label="Timeline actions"]');
 assert.ok(!(await page.$$eval('[role="menuitem"]',nodes=>nodes.map(node=>node.textContent))).includes('Split here'),'Transition menu has no clip split action');
 await page.locator('::-p-aria([name="Copy transition"][role="menuitem"])').click();await flush();
 await page.focus('[aria-label="Add transition at 6.00s"]');await page.keyboard.press('ContextMenu');await page.waitForSelector('[aria-label="Timeline actions"]');
 await page.locator('::-p-aria([name="Paste here"][role="menuitem"])').click();await flush();
 assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.filter(clip=>clip.kind==='effect').length),2,'Paste copies only the transition onto the exact new cut');
 assert.deepEqual(await page.evaluate(()=>window.fixture.timeline.clips.filter(clip=>clip.kind!=='effect')),sourceClips,'Cut controls never duplicate source clips');
 await page.click('[aria-label="Blur dissolve at 6.00s"]');await page.waitForSelector('[aria-label="Choose transition"]');
 await page.locator('::-p-aria([name="Remove transition"][role="menuitem"])').click();await flush();
 assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.filter(clip=>clip.kind==='effect').length),1);
 await page.click('#undo');await flush();assert.ok(await page.$('[aria-label="Blur dissolve at 6.00s"]'),'Undo restores a removed transition at the cut');
 await (await page.$('.fixture-timeline')).screenshot({path:'/tmp/revline-cut-transitions-dark.png'});
 await page.evaluate(()=>document.documentElement.dataset.workspaceTheme='light');await (await page.$('.fixture-timeline')).screenshot({path:'/tmp/revline-cut-transitions-light.png'});await page.evaluate(()=>document.documentElement.dataset.workspaceTheme='dark');
 await page.evaluate(()=>window.fixture.incompatible());await library();assert.equal(await page.$eval('[aria-label="Crossfade"]',node=>node.getAttribute('aria-disabled')),'true');assert.ok(await page.$eval('.library-transition-availability',node=>node.textContent.includes('same blend mode')),'Unequal source blend modes explain why this cut is unavailable');
 await page.evaluate(()=>window.fixture.short());await library();await button('Crossfade').click();await page.waitForSelector('[aria-label="Crossfade transition settings"]');assert.equal(await page.$eval('[aria-label="Duration"]',node=>node.disabled),true,'One-frame retained clips have a fixed two-frame transition');assert.ok(Math.abs(await page.$eval('[aria-label="Duration"]',node=>Number(node.value))-2/30)<1e-6);assert.equal(await page.$eval('.transition-controls .effect-slider-fill',node=>node.style.width),'0%','A fixed duration has a valid slider fill');
 await page.setViewport({width:340,height:820});await page.addStyleTag({content:'#root{display:block;padding:10px}.fixture-inspector{width:320px;height:700px}.fixture-timeline{display:none}'});await flush();assert.ok(await page.$eval('.preview-inspector',node=>node.scrollWidth<=node.clientWidth),'Transition settings fit 320px');
 assert.deepEqual(errors,[]);console.log('PASS: actual library Crossfade/Spin zoom/Blur dissolve actions, distinct icons, selected pair and centered duration draft/commit, spin direction menu edits, undo, source/audio timing retention, middle-clip automatic cut, cut badges instead of FX blocks, duration handles and cancellation, cut-menu add/replace/copy/paste/remove, and one-step Undo, valid-cut drop and invalid target rejection. Isolated synthetic footage only.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
