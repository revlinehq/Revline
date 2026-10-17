import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import puppeteer from 'puppeteer';

const stubs={
 'next/navigation':`export function useRouter(){return {push:url=>window.routes.push(url)}}`,
 '@clerk/nextjs':`export function useAuth(){return {isLoaded:true,isSignedIn:true,userId:'fixture-owner'}}export function useUser(){return {user:{firstName:'Demo'}}}export function useClerk(){return {openSignIn(){}}}`,
 'convex/react':`import {getFunctionName} from 'convex/server';export function useConvexAuth(){return {isAuthenticated:true,isLoading:false}}export function useQuery(){return []}export function useConvex(){return {query:async fn=>getFunctionName(fn)==='assets:get'?{_id:'owned-asset',kind:'video',duration:5,width:32,height:18,url:'https://fixture.invalid/owned.mp4',audioExtracted:true}:{timeline:window.savedTimeline??{aspectRatio:'vertical',fps:30,clips:[],tracks:{visual:0,audio:0,overlay:0,effects:0},markers:[]},revision:0}}}export function useMutation(fn){return async args=>{const name=getFunctionName(fn);window.calls.push({name,args});if(name==='projects:create')return new Promise(resolve=>window.releaseCreate=()=>resolve('fixture-project'));if(name==='projects:saveTimeline'){window.savedTimeline=args.timeline;}return {revision:1}}}export const useAction=useMutation;`,
 './project-draft':`export function takeFiles(){return location.search.includes('ready')?Promise.resolve([]):new Promise(resolve=>window.restore=resolve)}export async function stashFiles(files){window.stashes.push(files.map(file=>({name:file.name,type:file.type})));}export async function acknowledgeDraftFiles(){window.acknowledged=(window.acknowledged??0)+1}`,
 './recent-projects':`import React from 'react';export function RecentProjects(){return <section id="nested" onDrop={event=>event.stopPropagation()}>Recent project child drop handler</section>}`,
 './workspace-nav':`import React from 'react';export function WorkspaceNav(){return <nav className="workspace-nav">Revline</nav>}`,
 '@/components/editor/media-import-dialog':`export function MediaImportDialog(){return null}`,
 '@/lib/editor/upload-source':`export async function uploadSourceFile(file,transport,onProgress){window.uploaded.push({name:file.name,type:file.type});transport.onThumbnail?.(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="352" height="198"><rect width="352" height="198" fill="#27364a"/><circle cx="176" cy="99" r="54" fill="#4768ef"/></svg>'],{type:'image/svg+xml'}));onProgress(42,'uploading');return new Promise(resolve=>window.finishSource=()=>{onProgress(100,'saving');resolve('owned-asset')})}`,
 '@/lib/editor/prepare-media-for-editing':`import{api}from'@/convex/_generated/api';export async function prepareMediaForEditing(client,projectId,assetId,onActivity){onActivity?.({phase:'processing',activity:'Preparing media…'});return client.query(api.assets.get,{projectId,assetId})}`,
 '@/lib/editor/prepare-video-audio':`export async function prepareVideoAudio(){}export async function prepareAudioWaveform(){}`,
};
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {NewConversation} from './components/workspace/new-conversation';import {openingFootage} from './lib/editor/footage-opening';import {startNewWorkspace} from './components/workspace/start-new-workspace';window.startFresh=()=>startNewWorkspace('fixture-owner');window.openingHint=()=>openingFootage('fixture-project');import './components/workspace/workspace-pages.css';window.calls=[];window.routes=[];window.stashes=[];window.uploaded=[];window.drop=(selector,type='',internal=false)=>{const transfer=new DataTransfer();if(internal)transfer.setData('revline/asset','existing');else transfer.items.add(new File(['synthetic'],'dropped.mp4',{type,lastModified:1}));document.querySelector(selector).dispatchEvent(new DragEvent('dragenter',{dataTransfer:transfer,bubbles:true,cancelable:true}));return !document.querySelector(selector).dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));};createRoot(document.getElementById('root')).render(<NewConversation/>);`},plugins:[{name:'owned-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}));}}],bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-dashboard-drop',define:{'process.env.NODE_ENV':'"production"'}});
const server=createServer((req,res)=>{const path=req.url?.split('?')[0];const asset=path==='/bundle.js'?['text/javascript',bundle.outputFiles.find(file=>file.path.endsWith('.js')).text]:path==='/style.css'?['text/css',bundle.outputFiles.find(file=>file.path.endsWith('.css')).text]:['text/html','<html data-workspace-theme="dark"><head><link rel="stylesheet" href="/style.css"><style>*{box-sizing:border-box}body{margin:0;font:13px Arial;background:#111}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'];res.setHeader('Content-Type',asset[0]);res.end(asset[1]);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const url=`http://127.0.0.1:${server.address().port}/dashboard/new-project`;
try{
 await page.setViewport({width:1100,height:800});await page.goto(url);await page.waitForSelector('.footage-start-card');
 assert.equal(await page.$eval('.footage-start-card',el=>el.disabled),true,'Begin while browser draft restoration is pending');
 await page.evaluate(()=>window.drop('.footage-start-card','video/mp4'));await flush();
 assert.equal(await page.$('.footage-preparation')!==null,true,'A drop before draft restoration is accepted rather than silently discarded');
 assert.equal(await page.$eval('.footage-preparation-filename',el=>el.textContent),'dropped.mp4');assert.ok(await page.$eval('.footage-preparation',el=>el.getBoundingClientRect().height)>600,'The loading screen must cover the viewport below the header');
 await page.evaluate(()=>window.restore([new File(['old'],'stale.mp4',{type:'video/mp4'})]));await flush();
 assert.equal(await page.$eval('.footage-preparation-filename',el=>el.textContent),'dropped.mp4','Late restoration never overwrites newly dropped footage');
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.name==='projects:create').length),1,'One drop creates one project');
 await page.evaluate(()=>window.releaseCreate());await page.waitForFunction(()=>document.querySelector('.footage-preparation-activity')?.textContent.includes('42%'));
 await page.waitForFunction(()=>document.querySelector('.footage-preparation-thumbnail img')?.complete);
 const uploading=await page.evaluate(()=>{const sweep=document.querySelector('.processing-status-sweep'),probe=document.createElement('span');probe.style.color='var(--revline-loading-color)';sweep.append(probe);const loadingColor=getComputedStyle(probe).color;probe.remove();return{title:document.querySelector('.processing-status-label').textContent,rect:document.querySelector('.footage-preparation').getBoundingClientRect().toJSON(),sweep:getComputedStyle(sweep,'::after').backgroundImage,loadingColor,poster:document.querySelector('.footage-preparation-thumbnail img').src}});
 assert.equal(uploading.rect.y,56);assert.equal(uploading.rect.height,744);assert.ok(uploading.sweep.includes(uploading.loadingColor),'Loading sweep follows the shared brand color');assert.match(uploading.poster,/^blob:/);assert.equal(await page.$('.new-conversation-intro'),null);
 await page.screenshot({path:'/tmp/revline-dashboard-loading.png'});
 await page.evaluate(()=>window.finishSource());await page.waitForFunction(()=>window.routes.length===1);
 assert.equal(uploading.title,'Uploading footage…');
 assert.equal(await page.$eval('.processing-status-label',el=>el.textContent),'Processing footage…','Completed transfers switch to a distinct processing state');
 assert.deepEqual(await page.$eval('.footage-preparation',el=>el.getBoundingClientRect().toJSON()),uploading.rect);
 assert.equal(await page.evaluate(()=>window.openingHint().fileName),'dropped.mp4');
 assert.equal(await page.evaluate(()=>window.openingHint().ownsThumbnail),true,'The handoff owns a distinct poster URL that survives upload view cleanup');
 assert.notEqual(await page.evaluate(()=>window.openingHint().thumbnail),uploading.poster);

 await page.goto(url+'?ready');await page.waitForFunction(()=>!document.querySelector('.footage-start-card').disabled);
 await page.evaluate(()=>window.drop('.footage-start-card','video/mp4'));await page.waitForFunction(()=>typeof window.releaseCreate==='function');
 await page.evaluate(()=>window.releaseCreate());await page.waitForFunction(()=>typeof window.finishSource==='function');
 await page.evaluate(()=>window.startFresh());await page.waitForSelector('.footage-start-card');
 assert.equal(await page.$('.footage-preparation'),null,'Explicit new workspace clears the old import screen');
 await page.evaluate(()=>window.finishSource());await page.waitForFunction(()=>window.acknowledged===1);await flush();
 assert.deepEqual(await page.evaluate(()=>window.routes),[],'A detached old import cannot redirect the fresh workspace');
 assert.ok(await page.$('.footage-start-card'),'A fresh workspace stays ready for the next upload');

 await page.goto(url+'?ready');await page.waitForFunction(()=>!document.querySelector('.footage-start-card').disabled);
 await page.evaluate(()=>window.drop('#nested'));await flush();
 assert.equal(await page.$('.footage-preparation')!==null,true,'Files dropped over nested handlers enter the shared capture path');
 assert.equal(await page.evaluate(()=>window.stashes.at(-1)[0].type),'video/mp4','OS files with missing MIME use their supported extension');
 await page.goto(url+'?ready');await page.waitForFunction(()=>!document.querySelector('.footage-start-card').disabled);
 await page.evaluate(()=>window.drop('.footage-start-card','',true));await flush();
 assert.equal(await page.$('.footage-preparation'),null,'Internal asset drags never create projects');
 assert.equal(await page.evaluate(()=>window.calls.length),0);
 await page.evaluate(()=>window.drop('.footage-start-card','text/plain'));await flush();
 assert.match(await page.$eval('[role=alert]',el=>el.textContent),/nonempty video, audio, or image/);
 assert.equal(await page.evaluate(()=>window.calls.length),0);
 assert.deepEqual(errors,[]);console.log('PASS: early drops survive restoration, nested drops are captured, missing MIME normalized, one project per drop, internal/non-media drags rejected. Synthetic backend only.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
