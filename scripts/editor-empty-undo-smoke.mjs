import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import puppeteer from 'puppeteer';
const stubs={
 'convex/react':`import {getFunctionName} from 'convex/server';const empty=[],timeline={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[{id:'words',kind:'graphic',text:'Actual text',start:0,duration:3,sourceStart:0,track:1}]};const project={_id:'fixture-project',title:'Undo fixture',aspectRatio:'landscape',revision:1,timeline,history:window.scenario==='empty'?[]:[{...timeline,clips:[{...timeline.clips[0],text:'Before'}]}]};const mutations={},actions={};window.stats={undo:0,saves:0,undoTargets:[]};export const useConvexAuth=()=>({isAuthenticated:true});export const useConvex=()=>({query:async()=>project});export function useQuery(fn){const name=getFunctionName(fn);return name==='projects:get'?project:name==='projects:history'?project.history:name==='assistant:status'?{running:false,configured:false}:empty}export function useMutation(fn){const name=getFunctionName(fn);return mutations[name]??=async args=>{if(name==='projects:undo'){window.stats.undo++;await new Promise(resolve=>window.releaseUndo=resolve);if(window.scenario==='stale')throw Error('No edits to undo');return 2}if(name==='projects:saveTimeline'){window.stats.saves++;if(args.undoTo)window.stats.undoTargets.push(args.undoTo.clips[0].text);return{timeline:args.timeline,revision:++window.savedRevision}}};}export function useAction(fn){return actions[getFunctionName(fn)]??=async()=>{throw Error('Unexpected action')}};`,
 '@convex-dev/agent/react':`const results=[];export const useUIMessages=()=>({results,status:'Exhausted',loadMore:()=>{}});`,
 'next/link':`export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
 '@/components/workspace/editor-access-gate':`export function EditorAccessGate({children}){return children}`,
 '@/components/workspace/workspace-nav':`export function WorkspaceNav(){return null}`,
 '@/components/workspace/project-draft':`export const takeFiles=async()=>[],acknowledgeDraftFiles=async()=>{};`,
 '@/lib/editor/prepare-video-audio':`export const prepareVideoAudio=async()=>{},prepareAudioWaveform=async()=>{};`,
 './editor-shell':`import {useEditorStore} from './components/editor/editor-state';export function EditorShell(p){window.shell=p;window.store=useEditorStore();return <><button id="undo" disabled={!p.canUndo} onClick={p.onUndo}>Undo</button><button id="redo" disabled={!p.canRedo} onClick={p.onRedo}>Redo</button><output id="error">{p.error}</output><output id="words">{p.timeline.clips[0]?.text}</output></>}`,
};
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import {createRoot} from 'react-dom/client';import {ConnectedEditor} from './components/editor/connected-editor';window.savedRevision=1;createRoot(document.getElementById('root')).render(<ConnectedEditor projectId="fixture-project"/>);`},plugins:[{name:'synthetic-transport',setup(builder){builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}))}}],bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-undo-fixture',define:{'process.env.NODE_ENV':'"production"'}});
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end('<div id="root"></div>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=768']});const page=await browser.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(error.message));const script=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
try{
 for(const scenario of ['empty','history']){
  await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(scenario=>{window.scenario=scenario;Object.defineProperty(window,'sessionStorage',{value:{getItem:()=>null,removeItem:()=>{}}})},scenario);await page.addScriptTag({content:script});await page.waitForSelector('#undo');
  if(scenario==='empty'){
   assert.equal(await page.$eval('#undo',button=>button.disabled),true);await page.evaluate(()=>{for(let i=0;i<20;i++)window.shell.onUndo()});await flush();assert.equal(await page.evaluate(()=>window.stats.undo),0,'Empty Ctrl+Z path never calls server undo');
   await page.evaluate(()=>{const timeline=window.shell.timeline;window.shell.onChange({...timeline,clips:[{...timeline.clips[0],text:'Changed'}]})});await page.waitForFunction(()=>window.shell.canUndo);await page.click('#undo');await page.waitForFunction(()=>document.querySelector('#words').textContent==='Actual text');assert.equal(await page.evaluate(()=>window.stats.undo),0,'Local undo keeps working without backend history');
  }else{
   assert.equal(await page.$eval('#undo',button=>button.disabled),false);await page.click('#undo');await page.waitForFunction(()=>document.querySelector('#words').textContent==='Before');await page.waitForFunction(()=>document.querySelector('#undo').disabled);
   await page.evaluate(()=>{for(let i=0;i<20;i++)window.shell.onUndo()});await flush();assert.equal(await page.evaluate(()=>window.stats.undo),0,'Exhausted local history must never fall back to server snapshots of undo operations');
   assert.deepEqual(await page.evaluate(()=>window.stats.undoTargets),['Before'],'Undo saves identify the consumed history target');
   await page.click('#redo');await page.waitForFunction(()=>document.querySelector('#words').textContent==='Actual text');await page.click('#undo');await page.waitForFunction(()=>document.querySelector('#words').textContent==='Before');

  }
  assert.equal(await page.$eval('#error',element=>element.textContent),'','No empty-undo server error reaches the editor');
 }
 assert.deepEqual(errors,[]);console.log('PASS: real ConnectedEditor empty/exhausted undo never falls back to server, consumed undo targets persist explicitly and redo remains undoable. Synthetic transport only.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
