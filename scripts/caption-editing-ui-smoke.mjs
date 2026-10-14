import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {useStore} from 'zustand';
import {TextEffectsControls} from './components/editor/text-effects-controls';import {createEditorStore} from './lib/editor/store';
import {updateCaptionTiming,applyCaptionStyle} from './lib/editor/caption-editing';import {DEFAULT_TEXT_APPEARANCE} from './lib/editor/text-style';import {remotionTextProps} from './lib/editor/remotion-text';
import './components/workspace/workspace-pages.css';import './app/editor.css';
const initial={fps:30,aspectRatio:'vertical',tracks:{visual:1,overlay:0,audio:1,effects:0},clips:[
{id:'first',kind:'caption',start:0,duration:2,sourceStart:0,track:1,text:'First exact words',color:'#12ab67',fontSize:57,fontFamily:'dm-serif',background:'#18263b',textStyle:{...DEFAULT_TEXT_APPEARANCE,strokeWidth:3,glowBlur:18},textTemplate:{preset:'word-reveal',duration:2,offset:0}},
{id:'second',kind:'caption',start:2.5,duration:3,sourceStart:0,track:1,text:'Second exact words',color:'#ffcc00',fontSize:61,animation:'fade'},
{id:'title',kind:'graphic',start:7,duration:2,sourceStart:0,track:1,text:'Other text',color:'#ff6600'},
{id:'audio',kind:'audio',start:0,duration:10,sourceStart:0,track:1,volume:.7}]};
const store=createEditorStore(initial);store.setState({selectedId:'first'});window.fixture={store,initial,frame:time=>remotionTextProps(store.getState().timeline.clips.find(clip=>clip.id==='first'),time,30)?.frame};
function Fixture(){const timeline=useStore(store,state=>state.timeline),selected=useStore(store,state=>state.selectedId),clip=timeline.clips.find(item=>item.id===selected);return <div className="preview-inspector"><button id="undo" onClick={()=>store.getState().undo()}>Undo</button><TextEffectsControls clip={clip} onChange={()=>{}} captionActions={{fps:timeline.fps,count:timeline.clips.filter(item=>item.kind==='caption').length,onTiming:changes=>store.getState().edit(updateCaptionTiming(timeline,clip.id,changes)),onApplyStyle:()=>store.getState().edit(applyCaptionStyle(timeline,clip.id))}}/></div>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-caption-ui',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const page=await browser.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const setNumber=async(label,value)=>{await page.focus('[aria-label="'+label+'"]');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.type(String(value));await page.keyboard.press('Enter');await flush();};
try {
 await page.setViewport({width:400,height:900});await page.setContent('<html data-workspace-theme="dark"><body><div id="root"></div></body></html>');await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:0;font:12px Arial;background:var(--ws-bg)}#root{width:320px;margin:20px auto}.preview-inspector{height:860px;overflow:auto;padding:18px}'});await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});await page.waitForSelector('[aria-label="Selected text"]');
 assert.ok(await page.$('[aria-label="Caption start"]'),'Saved caption timing is editable');
 const originalFrame=await page.evaluate(()=>window.fixture.frame(.7));await setNumber('Caption start',.217);await setNumber('Caption end',1.8);
 const edited=await page.evaluate(()=>window.fixture.store.getState().timeline.clips[0]);assert.equal(edited.start,7/30);assert.equal(edited.duration,1.8-7/30);assert.equal(edited.text,'First exact words');assert.equal(await page.evaluate(()=>window.fixture.frame(.7)),originalFrame,'Editing timing retains the animation source phase');
 await setNumber('Caption end',3);assert.ok(await page.$('[role="alert"]'),'Overlapping captions produce a useful inline error');assert.equal(await page.evaluate(()=>window.fixture.store.getState().timeline.clips[0].duration),edited.duration,'Invalid timing does not edit the timeline');
 const before=await page.evaluate(()=>window.fixture.store.getState().timeline);await page.click('[aria-label="Apply style to all captions"]');await flush();const after=await page.evaluate(()=>window.fixture.store.getState().timeline);
 assert.equal(after.clips[1].color,before.clips[0].color);assert.equal(after.clips[1].fontFamily,before.clips[0].fontFamily);assert.deepEqual(after.clips[1].textStyle,before.clips[0].textStyle);
 for(const key of ['text','start','duration','sourceStart','animation','textTemplate','textAnimationTiming']) assert.deepEqual(after.clips[1][key],before.clips[1][key],'Bulk style preserves '+key);
 assert.deepEqual(after.clips.slice(2),before.clips.slice(2),'Other text and audio stay intact');await page.click('#undo');await flush();assert.deepEqual(await page.evaluate(()=>window.fixture.store.getState().timeline),before,'The bulk style action is one undo step');
 await page.screenshot({path:'/tmp/revline-caption-timing-style.png'});assert.ok(await page.$eval('.preview-inspector',node=>node.scrollWidth<=node.clientWidth));assert.deepEqual(errors,[]);
 console.log('PASS: actual caption timing fields snap frames and preserve animation phase, reject overlaps without edits, appearance-only bulk copy preserves words/timing/animation and other clips, one undo step, 320px fit.');
}finally{await browser.close();}
