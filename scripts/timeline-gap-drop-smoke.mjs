import assert from 'node:assert/strict';
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {TimelinePanel} from './components/editor/timeline';import {TooltipProvider} from './components/ui/tooltip';import {EditorStateProvider,useEditorState} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';import './components/workspace/workspace-pages.css';import './app/editor.css';
const initial={fps:30,aspectRatio:'landscape',tracks:{visual:2,audio:0,effects:0,overlay:0},clips:[{id:'left',kind:'image',track:1,start:0,duration:4,sourceStart:0},{id:'right',kind:'image',track:1,start:6,duration:2,sourceStart:0},{id:'moving',kind:'image',track:1,start:9,duration:2,sourceStart:0}]};const store=createEditorStore(initial);window.fixture=store;window.initial=initial;window.fixtureEvents={seek:[],edit:[]};function Fixture(){const[locked,setLocked]=React.useState(false);window.setEditingLocked=setLocked;const t=useEditorState(s=>s.timeline),id=useEditorState(s=>s.selectedId);return <TimelinePanel editingLocked={locked} timeline={t} assets={[]} selected={id} onSelect={id=>store.setState({selectedId:id,selectedIds:[id]})} time={0} playing={false} onSeek={at=>{window.fixtureEvents.seek.push(at);store.setState({playhead:at});}} onEditClip={id=>window.fixtureEvents.edit.push(id)} onChange={t=>store.getState().edit(t)} onSplit={()=>{}} onDelete={()=>{}} onDuplicate={()=>{}} onAddText={()=>{}}/>}createRoot(document.getElementById('root')).render(<TooltipProvider><EditorStateProvider store={store}><Fixture/></EditorStateProvider></TooltipProvider>);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-gap-drop-fixture',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
const frames=()=>page.evaluate(()=>new Promise(resolve=>{let i=0;const tick=()=>++i===5?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
const state=()=>page.evaluate(()=>({timeline:window.fixture.getState().timeline,history:window.fixture.getState().history.length}));
async function reset(timeline,compactTracks=false){await page.evaluate(({timeline,compactTracks})=>{window.fixture.getState().recover(timeline??window.initial);window.fixture.setState({compactTracks,selectedId:null,selectedIds:[],snap:true});document.querySelector('.timeline-scroll').scrollTop=0;},{timeline,compactTracks});await frames();}
async function drag(id,dx,targetY,grab=30){const box=await page.$eval('.timeline-clip[data-clip-id="'+id+'"]',el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});const x=box.x+grab,y=box.y+box.h/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,targetY??y,{steps:8});await frames();await page.mouse.up();await frames();}
try{
 await page.setViewport({width:1400,height:650});await page.setContent('<html data-workspace-theme="dark"><body><div id="root" class="editor-app conversation-editor"></div></body></html>');await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.css')).text});await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:0;font:12px Arial}#root{width:1300px;height:450px;margin:60px auto;display:flex;padding:0}button{border:0;background:transparent;color:inherit;font:inherit}'});await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});await page.waitForSelector('[data-clip-id="moving"]');
 for(const compact of [false,true])for(const miss of [-16,16])for(const grab of [12,80]){
  await reset(undefined,compact);const before=await state();await drag('moving',-5*54+miss,undefined,grab);const after=await state();assert.equal(after.timeline.clips.find(c=>c.id==='moving').start,4,'A drop 16px either side of the exact gap fits without overlap');assert.equal(after.history,before.history+1,'One drag is one edit');assert.equal(after.timeline.tracks.visual,2);await page.evaluate(()=>window.fixture.getState().undo());await frames();assert.equal((await state()).timeline.clips.find(c=>c.id==='moving').start,9);
 }
 await reset();await page.keyboard.down('Alt');await drag('moving',-5*54-16);await page.keyboard.up('Alt');assert.equal((await state()).timeline.clips.find(c=>c.id==='moving').start,9,'Alt bypasses magnetic gap assistance');
 await reset();await drag('moving',-5*54-40);assert.equal((await state()).timeline.clips.find(c=>c.id==='moving').start,9,'A genuine overlap remains rejected');
 const linked={fps:30,aspectRatio:'landscape',tracks:{visual:2,audio:1,effects:0,overlay:0},clips:[{id:'v',kind:'video',track:1,start:0,duration:2,sourceStart:4,linkedClipId:'a',audioSeparated:true,volume:0},{id:'a',kind:'audio',track:1,start:0,duration:2,sourceStart:4,linkedClipId:'v'},{id:'music',kind:'audio',track:1,start:3,duration:4,sourceStart:0}]};
 for(const compact of [false,true])for(const newRow of [false,true]){
  await reset(linked,compact);const before=await state();const y=await page.$eval('.timeline-track[data-group="visual"][data-layer="2"]',(el,newRow)=>{const r=el.getBoundingClientRect();return newRow?r.top-8:r.y+r.height/2;},newRow);await drag('v',3*54,y);const after=await state();assert.equal(after.timeline.tracks.visual,newRow?3:2);assert.equal(after.timeline.tracks.audio,2);assert.equal(after.history,before.history+1);assert.deepEqual(after.timeline.clips.find(c=>c.id==='music'),linked.clips[2]);for(const id of ['v','a']){const clip=after.timeline.clips.find(c=>c.id===id);assert.equal(clip.start,3);assert.equal(clip.sourceStart,4);assert.equal(clip.track,id==='a'?2:newRow?3:2);}await page.evaluate(()=>window.fixture.getState().undo());await frames();assert.deepEqual((await state()).timeline,linked);
 }
 // One-click packing keeps source trims and is disabled while AI owns the edit.
 await reset(linked);await page.evaluate(()=>window.setEditingLocked(true));await frames();
 assert.equal(await page.$eval('[aria-label="Close gaps"]',button=>button.disabled),true);
 await page.evaluate(()=>window.setEditingLocked(false));await frames();
 const spaced={...linked,clips:[...linked.clips.map(c=>({...c,start:c.start+2})),{id:'tail',kind:'video',track:1,start:7,duration:1,sourceStart:8}]};
 await reset(spaced);await page.click('[aria-label="Close gaps"]');await frames();
 assert.deepEqual((await state()).timeline.clips.filter(c=>c.kind==='video').map(c=>c.start),[0,2]);
 assert.equal((await state()).history,1,'Close gaps is one undoable edit');
 await page.evaluate(()=>window.fixture.getState().undo());await frames();assert.deepEqual((await state()).timeline.clips,spaced.clips);
 // Double-click video/audio at a point seeks there and still opens its settings.
 await reset(linked);await page.evaluate(()=>{window.fixtureEvents={seek:[],edit:[]};});
 for(const id of ['v','a']){
  const box=await page.$eval('[data-clip-id="'+id+'"]',el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,h:r.height};});
  await page.mouse.click(box.x+54,box.y+box.h/2,{count:2});await frames();
  assert.equal(await page.evaluate(()=>window.fixtureEvents.seek.at(-1)),1,'Double-click seeks to the clicked second');
  assert.equal(await page.evaluate(()=>window.fixtureEvents.edit.at(-1)),id,'Double-click still opens clip settings');
 }
 const seekCount=await page.evaluate(()=>window.fixtureEvents.seek.length);await drag('v',54);assert.equal(await page.evaluate(()=>window.fixtureEvents.seek.length),seekCount,'Dragging does not seek');
 assert.deepEqual(errors,[]);console.log('PASS: Close gaps toolbar packing, linked audio, undo and AI lock; double-click video/audio seeks at pointer and opens settings; near-gap drops from either side and different grab points, normal/compact tracks, Alt bypass, true overlap rejection, automatic linked-audio row on existing/new video rows, single-edit undo.');
}finally{await browser.close();}
