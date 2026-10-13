import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {tsImport} from 'tsx/esm/api';
const module=await tsImport('../lib/editor/composition.ts',import.meta.url);
const generateComposition=module.generateComposition??module.default.generateComposition;
const before={fps:30,aspectRatio:'square',tracks:{visual:3,overlay:0,audio:0,effects:0},clips:[{id:'plain',kind:'caption',track:2,start:0,sourceStart:0,duration:3,text:'Plain words',x:.5,y:.7},{id:'animated',kind:'graphic',track:3,start:0,sourceStart:0,duration:3,text:'Animated words',x:.5,y:.3,textTemplate:{preset:'word-pop',duration:3,offset:0}}]};
const transform=rotation=>({x:.5,y:.5,scale:1,opacity:1,rotation});
const after={...before,clips:before.clips.map((clip,index)=>({...clip,text:index?'Edited animated words':'Edited plain words',transform:transform(index?-30:25)}))};
const html=generateComposition(before,[]),exportHtml=generateComposition(after,[]);
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:"import {updateLiveTextEffects} from './lib/editor/live-preview-effects';window.applyTextTimeline=(previous,next)=>updateLiveTextEffects(document,previous,next);"},bundle:true,platform:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"production"'}});
const browser=await puppeteer.launch({headless:true,protocolTimeout:12000,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage(),errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});
await page.setRequestInterception(true);
page.on('request',async request=>{const url=new URL(request.url());try{
 if(url.hostname!=='text-fixture.revline.test')return request.abort();
 if(url.pathname==='/'||url.pathname==='/export')return request.respond({status:200,contentType:'text/html',body:url.pathname==='/export'?exportHtml:html});
 if(!/^\/(vendor|fonts)\/[\w./-]+$/.test(url.pathname))return request.abort();
 const contentType=url.pathname.endsWith('.woff2')?'font/woff2':'application/javascript';
 await request.respond({status:200,contentType,body:await readFile('public'+url.pathname)});
 }catch(error){errors.push(error.message);await request.abort()}});
const read=()=>page.evaluate(()=>[0,1].map(index=>{const node=document.getElementById('clip-'+index),matrix=new DOMMatrix(getComputedStyle(node).transform);return{text:node.querySelector('.text-content').textContent,rotation:Math.atan2(matrix.b,matrix.a)*180/Math.PI}}));
try{
 await page.setViewport({width:1080,height:1080});await page.goto('http://text-fixture.revline.test/',{waitUntil:'load',timeout:10000});await page.waitForSelector('[data-remotion-text]',{timeout:10000});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{window.__timelines.revline.seek(1);window.textBefore={plain:document.getElementById('clip-0'),animated:document.getElementById('clip-1'),clock:window.__timelines.revline,animation:window.__revlineTextTimelines['clip-0'],children:window.__revlineTextTimelines['clip-0'].getChildren()}});
 assert.equal(await page.evaluate(({before,after})=>window.applyTextTimeline(before,after),{before,after}),true,'Text edits update the current composition in place');
 const live=await read();assert.deepEqual(live.map(value=>value.text),['Edited plain words','Edited animated words']);assert.ok(Math.abs(live[0].rotation-25)<.001&&Math.abs(live[1].rotation+30)<.001,'Plain and Remotion parent layers rotate');
 assert.equal(await page.evaluate(()=>document.getElementById('clip-0')===window.textBefore.plain&&document.getElementById('clip-1')===window.textBefore.animated&&window.__timelines.revline===window.textBefore.clock&&window.__timelines.revline.time()===1),true,'Words and rotation keep the nodes and clock');
 assert.equal(await page.evaluate(({after})=>window.applyTextTimeline(after,JSON.parse(JSON.stringify(after))),{after}),true,'A saved acknowledgement is accepted without replaying text');
 assert.equal(await page.evaluate(()=>window.__revlineTextTimelines['clip-0'].getChildren().every((child,index)=>child===window.textBefore.children[index])),true,'Unchanged text animation is retained');
 await page.goto('http://text-fixture.revline.test/export',{waitUntil:'load'});await page.waitForSelector('[data-remotion-text]',{timeout:10000});await page.evaluate(()=>{window.__timelines.revline.seek(1)});
 assert.deepEqual(await read(),live,'Fresh export renders the same edited words and rotation as live preview');
 assert.deepEqual(errors,[]);console.log('PASS: Edited plain/animated words and rotation render in-place, preserve nodes/clock/animation, and match fresh exported composition. Owned isolated fixture only.');
}finally{await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,3000))]);browser.process()?.kill('SIGKILL')}
