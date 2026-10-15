import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import puppeteer from 'puppeteer';

// Exercise the real connected upload handler and save queue with a stalled worker.
// Only network/provider boundaries and the editor's display shell are replaced.
const stubs = {
  'next/link': `export default function Link(){return null}`,
  './editor-shell': `import React from 'react';export function EditorShell(p){return <main><button id="upload" onClick={()=>void p.onUpload([new File(['video'],'footage.mp4',{type:'video/mp4'})]).then(()=>window.finished++)}>Upload</button><button id="image" onClick={()=>void p.onUpload([new File(['image'],'still.png',{type:'image/png'})]).then(()=>window.finished++)}>Image</button><button id="drop" onClick={()=>void p.onDropUpload([new File(['video'],'source.mp4',{type:'video/mp4'})]).then(()=>window.finished++)}>Drop</button><output id="upload-status">{p.upload?.phase??'idle'}</output><output id="assets">{p.assets.length}</output><output id="clips">{JSON.stringify(p.timeline.clips)}</output><output id="error">{p.error}</output></main>}`,
  './timeline-share-dialog': `export function ConnectedTimelineShareDialog(){return null}`,
  '@/components/workspace/workspace-nav': `export function WorkspaceNav(){return null}`,
  '@/components/workspace/editor-access-gate': `export function EditorAccessGate(p){return p.children}`,
  './footage-preparation': `export function FootagePreparation(){return null}`,
  '@/components/workspace/project-draft': `export async function takeFiles(){return []}export async function acknowledgeDraftFiles(){window.acknowledged++}`,
  '@/lib/editor/upload-source': `export async function uploadSourceFile(file,transport,report){report(100,'saving');const id='source-'+Object.keys(window.sources).length;window.sources[id]={_id:id,fileName:file.name,kind:file.type.startsWith('image/')?'image':'video',duration:5,url:'https://fixture.invalid/'+id};return id}`,
  '@/lib/editor/prepare-video-audio': `export async function prepareVideoAudio(client,projectId,assetId){window.preparing++;await new Promise(resolve=>window.finishAudio=()=>{const a=window.sources[assetId];a.audioExtracted=true;a.audioAssetId=assetId+'-audio';window.sources[a.audioAssetId]={_id:a.audioAssetId,kind:'audio',fileName:'audio.m4a',duration:5,waveform:[0,1]};resolve()})}export async function prepareAudioWaveform(){throw Error('Unexpected waveform request')}`,
  '@/convex/_generated/api': `const group=names=>Object.fromEntries(names.map(name=>[name,new Proxy({},{get:(_,key)=>name+':'+String(key)})]));export const api=group(['projects','assets','assistant','mediaTasks','renders','playback','r2'])`,
  'convex/react': `import {EMPTY_TIMELINE} from '@/lib/editor/types';const project={_id:'fixture',title:'Upload test',aspectRatio:'16:9',timeline:EMPTY_TIMELINE,revision:0},empty=[],ai={running:false,configured:false};let revision=0;const client={query:async(name,args)=>name==='assets:get'?window.sources[args.assetId]:project};export const useConvex=()=>client;export const useConvexAuth=()=>({isAuthenticated:true});export function useQuery(name){if(name==='projects:get')return project;if(name==='assistant:status')return ai;return empty}export const useMutation=name=>async args=>name==='projects:saveTimeline'?{timeline:args.timeline,revision:++revision}:undefined;export const useAction=()=>async()=>undefined`,
};
const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ConnectedEditor}from'./components/editor/connected-editor';window.sources={};window.finished=0;window.preparing=0;window.acknowledged=0;createRoot(document.getElementById('root')).render(<ConnectedEditor projectId="fixture"/>);`},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:process.cwd()}));}}],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?result.outputFiles[0].text:'<div id="root"></div><script src="/fixture.js"></script>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.click('#upload');
 await page.waitForFunction(()=>Object.keys(window.sources).length===1);
 await page.waitForFunction(()=>window.finished===1,{timeout:2000}).catch(()=>assert.fail('A stored video must finish importing even while audio extraction is queued'));
 assert.equal(await page.$eval('#upload-status',n=>n.textContent),'idle','Completed source has no stale saving status');
 assert.equal(await page.evaluate(()=>window.acknowledged),1,'Only the completed import is acknowledged');
 let clips=await page.$eval('#clips',n=>JSON.parse(n.textContent));assert.equal(clips.length,1);assert.equal(clips[0].volume,1,'Original video audio remains audible during extraction');
 await page.waitForFunction(()=>window.preparing===1);await page.click('#image');await page.waitForFunction(()=>window.finished===2,{timeout:2000});assert.equal(await page.$eval('#upload-status',n=>n.textContent),'idle','Another upload can finish during background audio preparation');
 await page.evaluate(()=>window.finishAudio());await page.waitForFunction(()=>JSON.parse(document.querySelector('#clips').textContent).some(c=>c.kind==='audio'));
 clips=await page.$eval('#clips',n=>JSON.parse(n.textContent));assert.equal(clips.find(c=>c.kind==='video').audioSeparated,true);assert.equal(clips.filter(c=>c.kind==='image').length,1,'Audio completion preserves intervening edits');
 await page.click('#drop');await page.waitForFunction(()=>window.finished===3,{timeout:2000});assert.equal(await page.$eval('#assets',n=>Number(n.textContent)),4);assert.equal(await page.$eval('#clips',n=>JSON.parse(n.textContent).length),3,'Composer uploads remain sources without adding clips');
 assert.deepEqual(errors,[]);console.log('PASS: connected imports complete while extraction is queued, retain native audio, accept another upload, separate audio later, and keep composer uploads off the timeline. No network/AI calls.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
