import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import puppeteer from 'puppeteer';

// Drive the real AI edit session through the connected editor's live-query/store
// boundary. Backend/model IO and playback are replaced, not the timeline logic.
const fixture = `
import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {ConnectedEditor} from './components/editor/connected-editor';
import {EditSession} from './convex/lib/editSession';
import {addMediaClip,deleteClip,splitClip} from './lib/editor/operations';
let version=0;const listeners=new Set();
const assets=[{_id:'video',kind:'video',duration:12,audioExtracted:true,audioAssetId:'audio',url:'/video.mp4'},{_id:'audio',kind:'audio',duration:12,waveform:{peaks:'AAAA',samplesPerSecond:1},url:'/audio.m4a'}];
const initial=addMediaClip({fps:30,aspectRatio:'landscape',clips:[]},assets[0],'original');
window.fixture={project:{_id:'project',title:'Continuity',aspectRatio:'landscape',revision:0,history:[],timeline:initial},running:false,renders:[],mounts:0,unmounts:0,writes:[],
 subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},snapshot:()=>version,notify:()=>{version++;for(const fn of listeners)fn()},
 query:name=>name==='projects:get'?window.fixture.project:name==='projects:history'?window.fixture.project.history:name==='billing:status'?{enabled:false}:name==='assets:list'?assets:name==='assistant:status'?{running:window.fixture.running,configured:true}:[],
};
const f=window.fixture;
window.startEdit=()=>{f.running=true;f.project={...f.project,threadId:'streaming-thread',aiRunning:true};f.notify();
 window.edit=new EditSession(f.project.timeline,f.project.revision,{
  validate:async(_timeline,revision)=>{if(revision!==f.project.revision)throw Error('The timeline changed elsewhere');},
  apply:async(timeline,revision)=>{if(revision!==f.project.revision)throw Error('The timeline changed elsewhere');f.writes.push(timeline.clips.map(c=>c.id));f.project={...f.project,revision:revision+1,timeline};f.notify();return revision+1;},
 });};
window.stageDelete=()=>window.edit.checkpoint(t=>deleteClip(t,t.clips.find(c=>c.kind==='video').id));
window.stageReplacement=()=>window.edit.checkpoint(t=>addMediaClip(t,assets[0],'replacement'));
window.splitCurrent=()=>window.edit.checkpoint(t=>splitClip(t,t.clips.find(c=>c.kind==='video').id,3,'right'));
window.completeEdit=async()=>{await window.edit.complete('stop');f.running=false;f.project={...f.project,aiRunning:false};f.notify();};
createRoot(document.getElementById('root')).render(<ConnectedEditor projectId="project"/>);
`;
const mocks = {
  'convex/react': `import{useSyncExternalStore}from'react';import{getFunctionName}from'convex/server';const client={query:async fn=>window.fixture.query(getFunctionName(fn))};export const useConvex=()=>client;export function useQuery(fn,args){useSyncExternalStore(window.fixture.subscribe,window.fixture.snapshot);return args==='skip'?undefined:window.fixture.query(getFunctionName(fn))}export const useMutation=()=>async()=>{throw Error('Unexpected backend write')};export const useAction=useMutation;export const useConvexAuth=()=>({isAuthenticated:true,isLoading:false});`,
  '@convex-dev/agent/react': `export const useUIMessages=()=>({results:[],status:'Exhausted'})`,
  'editor-shell': `import React,{useEffect}from'react';export function EditorShell({timeline,aiRunning}){const f=window.fixture;f.renders.push({running:aiRunning,ids:timeline.clips.map(c=>c.id)});useEffect(()=>{f.mounts++;return()=>{f.unmounts++;}},[]);return <main data-editor><div data-preview/>{timeline.clips.length?timeline.clips.map(c=><div key={c.id} data-clip={c.id}>{c.kind}</div>):<p data-empty>Your clips will land here.</p>}</main>}`,
  'timeline-share-dialog': `export const ConnectedTimelineShareDialog=()=>null`,
  'workspace-nav': `export const WorkspaceNav=()=>null`,
  'project-draft': `export const takeFiles=async()=>[];export const acknowledgeDraftFiles=async()=>{}`,
  'upload-source': `export const uploadSourceFile=async()=>{throw Error('Not used')}`,
};
const bundle = await build({ stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'}, bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,outdir:'/tmp/revline-ai-timeline',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/^(convex\/react|@convex-dev\/agent\/react)$/},args=>({path:args.path,namespace:'mock'}));
  b.onResolve({filter:/(?:^|\/)(editor-shell|timeline-share-dialog|workspace-nav|project-draft|upload-source)$/},args=>({path:args.path.split('/').at(-1),namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:process.cwd()}));
}}] });
const server = createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<html><body><div id="root"></div></body></html>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
  await page.waitForSelector('[data-clip="original"]');
  const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>{window.previewNode=document.querySelector('[data-preview]');window.startEdit()});await flush();
  await page.evaluate(()=>window.stageDelete());await flush();
  assert.equal(await page.$$eval('[data-clip]',nodes=>nodes.length),2,'Staged deletion keeps the original linked video/audio visible');
  await page.evaluate(()=>window.stageReplacement());await flush();
  assert.deepEqual(await page.evaluate(()=>window.fixture.writes),[],'Neither deletion nor partial replacement is published');
  await page.evaluate(()=>window.completeEdit());await flush();
  assert.deepEqual(await page.$$eval('[data-clip]',nodes=>nodes.map(n=>n.dataset.clip)),['replacement','replacement-audio']);
  assert.equal(await page.evaluate(()=>window.fixture.renders.some(r=>r.ids.length===0)),false,'No render sees an intermediate empty timeline');
  assert.equal(await page.evaluate(()=>window.previewNode===document.querySelector('[data-preview]')),true,'AI status and atomic publication keep the preview subtree mounted');
  await page.evaluate(()=>window.startEdit());await page.evaluate(()=>window.splitCurrent());await flush();
  assert.equal(await page.$$eval('[data-clip]',nodes=>nodes.length),4,'Ordinary splits still update the connected editor live');
  await page.evaluate(()=>window.completeEdit());await flush();
  await page.evaluate(()=>window.startEdit());await page.evaluate(()=>window.stageDelete());await page.evaluate(()=>window.stageDelete());await flush();
  assert.equal(await page.$('[data-empty]'),null,'Intentional delete-all remains private until completion');
  await page.evaluate(()=>window.completeEdit());await flush();
  assert.ok(await page.$('[data-empty]'),'A successful final delete-all must display the genuine empty result');
  assert.deepEqual(await page.evaluate(()=>({mounts:window.fixture.mounts,unmounts:window.fixture.unmounts})),{mounts:1,unmounts:0});
  assert.deepEqual(errors,[]);
  console.log('PASS: actual EditSession → ConnectedEditor keeps linked clips visible during replacement, publishes once, preserves the mounted editor through first-thread/AI status updates, applies live splits, and shows intentional final delete-all. No model calls or real project writes.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
