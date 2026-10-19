import assert from 'node:assert/strict';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=await mkdtemp(join(tmpdir(),'revline-trim-'));
const sampleRate=8000,samples=sampleRate*6,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i/sampleRate*440*Math.PI*2)*(3000+Math.sin(i/sampleRate*2)*2000)),44+i*2);
const audioPath=join(dir,'trim-fixture.wav');await writeFile(audioPath,wav);
const browser=await puppeteer.launch({executablePath:'/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();await page.setViewport({width:1440,height:1001});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const bounds=selector=>page.$eval(selector,el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
async function trim(selector,side,delta){const handle=await bounds(`${selector} .clip-trim.${side}`);const before=await bounds(selector);await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);assert.equal(await page.$eval(`${selector} .clip-trim.${side}`,el=>getComputedStyle(el).cursor),'ew-resize');await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+delta,handle.y+handle.height/2,{steps:15});await wait(100);const live=await bounds(selector);assert.equal(await page.$eval('.editor-app',el=>getComputedStyle(el).cursor),'ew-resize');assert.ok(await page.$('.timeline-resize-readout'),'Resize duration should be visible');await page.mouse.up();await wait(300);assert.equal(await page.evaluate(()=>document.body.style.cursor),'');return {before,live,after:await bounds(selector)};}
try{
 await page.goto('http://localhost:3001/dev/editor',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready);
 const image='.clip-video';const short=await trim(image,'right',-40);assert.ok(short.live.width<short.before.width-20);assert.ok(Math.abs(short.live.width-short.after.width)<1);
 const extend=await trim(image,'right',80);assert.ok(Math.abs(extend.after.width-short.before.width)<1,'Image cannot extend through the next clip');
 await page.click('[aria-label="Undo"]');await wait(200);assert.ok(Math.abs((await bounds(image)).width-short.after.width)<1,'One undo reverts the entire edge gesture');await page.click('[aria-label="Undo"]');await wait(200);
 const input=await page.$('input[type="file"]');await input.uploadFile(audioPath);await page.waitForSelector('.clip-audio');await page.$eval('.clip-audio',el=>el.scrollIntoView({block:'nearest',inline:'center'}));await wait(250);
 assert.equal(await page.$eval('.clip-audio',el=>getComputedStyle(el).backgroundColor),'rgb(143, 93, 186)');
 const audioShort=await trim('.clip-audio','right',-90);assert.ok(audioShort.after.width<audioShort.before.width-60);const audioExtend=await trim('.clip-audio','right',180);assert.ok(Math.abs(audioExtend.after.width-audioShort.before.width)<2,'Audio extends back only to the source duration');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,liveTrim:true,neighborClamp:true,audioSourceClamp:true,oneUndoPerGesture:true,resizeCursor:true}));
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
