import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {tsImport} from 'tsx/esm/api';
import puppeteer from 'puppeteer';

const defaultClip={id:'title',kind:'caption',track:2,start:0,duration:2,sourceStart:0,text:'Keep these words',animation:'fade',color:'#ffffff',background:'transparent',textTemplate:{preset:'karaoke',duration:2,offset:0,highlightColor:'#FFFF00'}};
const defaults={before:{fps:30,aspectRatio:'landscape',clips:[defaultClip]},after:{fps:30,aspectRatio:'landscape',clips:[{...defaultClip,animation:'none',fontFamily:'anton',fontSize:80,color:'#AABBCC',transform:{x:.5,y:.5,scale:1,rotation:18,opacity:1},textStyle:{strokeWidth:3,strokeColor:'#102030',shadowBlur:0,shadowX:0,shadowY:0,shadowColor:'#000000',glowBlur:21,glowColor:'#2200AA'},textTemplate:{preset:'word-reveal',duration:2,offset:0}}]}};
const input=process.env.REVLINE_AGENT_TEXT_FIXTURE?JSON.parse(await readFile(process.env.REVLINE_AGENT_TEXT_FIXTURE,'utf8')):defaults;
const module=await tsImport('../lib/editor/composition.ts',import.meta.url),generateComposition=module.generateComposition??module.default.generateComposition;
const onlyText=timeline=>({...timeline,tracks:{visual:2,overlay:0,audio:0,effects:0},clips:timeline.clips.filter(clip=>clip.id==='title')});
const before=onlyText(input.before),after=onlyText(input.after);
const html=Object.fromEntries(['landscape','vertical'].map(aspectRatio=>[aspectRatio,{preview:generateComposition({...before,aspectRatio},[],{resolution:720}),export:generateComposition({...after,aspectRatio},[],{resolution:720})}]));
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:"import {updateLiveTextEffects} from './lib/editor/live-preview-effects';window.updateText=(before,after)=>updateLiveTextEffects(document,before,after);"},bundle:true,platform:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"production"'}});
const runtime=await build({entryPoints:['lib/editor/remotion-text-runtime.tsx'],bundle:true,platform:'browser',format:'iife',globalName:'__revlineRemotionText',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'}});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=512']}),page=await browser.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
page.on('request',async request=>{const url=new URL(request.url());try{
  if(url.hostname!=='agent-text.revline.test')return request.abort();
  const aspect=url.searchParams.get('aspect')??'landscape';
  if(url.pathname==='/')return request.respond({status:200,contentType:'text/html',body:html[aspect].preview});
  if(url.pathname==='/export')return request.respond({status:200,contentType:'text/html',body:html[aspect].export});
  if(url.pathname==='/vendor/remotion-text.js')return request.respond({status:200,contentType:'application/javascript',body:runtime.outputFiles[0].text});
  if(!/^\/(vendor|fonts)\/[\w./-]+$/.test(url.pathname))return request.abort();
  await request.respond({status:200,contentType:url.pathname.endsWith('.woff2')?'font/woff2':url.pathname.endsWith('.ttf')?'font/ttf':'application/javascript',body:await readFile('public'+url.pathname)});
}catch(error){errors.push(error.message);await request.abort()}});
const seek=time=>page.evaluate(time=>{window.__timelines.revline.seek(time)},time);
async function pixels(){const png=Buffer.from(await page.screenshot());return execFileSync('ffmpeg',['-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{input:png,maxBuffer:1280*720*3+32768})}
const ink=bytes=>{let count=0;for(let i=0;i<bytes.length;i+=3)if(Math.max(bytes[i],bytes[i+1],bytes[i+2])>24)count++;return count};
try{
 for(const aspect of ['landscape','vertical']){
  await page.setViewport(aspect==='landscape'?{width:1280,height:720}:{width:720,height:1280});await page.goto(`http://agent-text.revline.test/?aspect=${aspect}`);await page.waitForSelector('[data-remotion-text]');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{window.__timelines.revline.seek(.5);window.retained={node:document.querySelector('[data-text-clip]'),clock:window.__timelines.revline}});
  assert.equal(await page.evaluate(({before,after,aspect})=>window.updateText({...before,aspectRatio:aspect},{...after,aspectRatio:aspect}),{before,after,aspect}),true);await page.evaluate(()=>document.fonts.ready);
  const style=await page.evaluate(()=>{const node=document.querySelector('[data-text-clip]'),text=node.querySelector('[data-remotion-text]'),css=getComputedStyle(text),matrix=new DOMMatrix(getComputedStyle(node).transform);return{words:text.textContent,font:css.fontFamily,size:parseFloat(css.fontSize),color:css.color,stroke:css.webkitTextStrokeWidth,strokeColor:css.webkitTextStrokeColor,shadow:css.textShadow,rotation:Math.atan2(matrix.b,matrix.a)*180/Math.PI,preset:text.dataset.remotionText,retained:node===window.retained.node&&window.__timelines.revline===window.retained.clock&&window.retained.clock.time()===.5}});
  assert.equal(style.words,after.clips[0].text);assert.ok(style.font.includes('Anton'),JSON.stringify(style));assert.ok(Math.abs(style.size-80*2/3)<.001,JSON.stringify(style));assert.equal(style.color,'rgb(170, 187, 204)');assert.equal(style.stroke,'2px');assert.equal(style.strokeColor,'rgb(16, 32, 48)');assert.ok(style.shadow.includes('34, 0, 170')&&style.shadow.includes('14px'),JSON.stringify(style));assert.ok(Math.abs(style.rotation-18)<.001);assert.equal(style.preset,'word-reveal');assert.equal(style.retained,true);
  await seek(.05);const entrance=await pixels();await seek(1.1);const complete=await pixels();assert.ok(ink(complete)>ink(entrance)*1.5,'Actual Word reveal pixels expose more saved words over time');
  await seek(.05);assert.ok((await pixels()).equals(entrance),'Backward seek restores exact animated text pixels');
  await page.goto(`http://agent-text.revline.test/export?aspect=${aspect}`);await page.waitForSelector('[data-remotion-text]');await page.evaluate(()=>document.fonts.ready);await seek(.05);assert.ok((await pixels()).equals(entrance),'Fresh export composition matches live native-intent text pixels');
 }
  assert.deepEqual(errors,[]);console.log('PASS: actual native-intent text renders Anton/custom solid fill/rotation/stroke/glow with independent Word reveal, preserves nodes/clock, changes real pixels over time, seeks backward deterministically, and matches fresh export composition in landscape720 and vertical720.');
}finally{await browser.close()}
