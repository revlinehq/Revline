import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// Render the real file-drop surface and ConnectedEditor's upload pipeline.
// Only account, transport, and large workspace leaves are replaced. No real
// project, browser session, media worker, or external server is contacted.
const stubs = {
  'convex/react': `import {getFunctionName} from 'convex/server';
    const none=[], project={_id:'fixture-project',title:'Drop fixture',aspectRatio:'landscape',revision:0,timeline:{version:1,fps:30,aspectRatio:'landscape',clips:[{id:'existing',kind:'graphic',text:'Existing title',start:0,duration:3,sourceStart:0,track:1}],tracks:{visual:1,overlay:0,audio:0,effects:0}}};
    const name=getFunctionName;
    const actions={}, mutations={};
    const cloud={query:async(fn,args)=>{if(name(fn)==='assets:get')return window.savedAssets.find(a=>a._id===args.assetId);if(name(fn)==='projects:get')return project;throw Error('Unexpected query '+name(fn));}};
    export const useConvex=()=>cloud, useConvexAuth=()=>({isAuthenticated:true});
    export function useQuery(fn){const n=name(fn);if(n==='projects:get')return project;if(n==='assistant:status')return {running:false,configured:false};return none;}
    export function useMutation(fn){const n=name(fn);return mutations[n]??=async args=>{if(n==='projects:saveTimeline'){window.savedTimelines.push(args.timeline);return {timeline:args.timeline,revision:++project.revision};}};}
    export function useAction(fn){const n=name(fn);return actions[n]??=async args=>{
      if(n==='r2:start'){window.pendingAsset={_id:'asset-'+(window.savedAssets.length+1),fileName:args.fileName,kind:args.kind,width:args.width,height:args.height};return {uploadId:'fixture-upload',partSize:10000};}
      if(n==='r2:partUrl')return '/fake-upload';
      if(n==='r2:complete'){if(window.holdUpload)await new Promise(resolve=>window.finishUpload=resolve);const asset=window.pendingAsset;window.savedAssets.push(asset);return asset._id;}
      throw Error('Unexpected action '+n);
    };}`,
  '@convex-dev/agent/react': `const messages=[];export const useUIMessages=()=>({results:messages,status:'Exhausted',loadMore:()=>{}});`,
  'next/link': `export default function Link({children,...props}){return <a {...props}>{children}</a>;}`,
  '@/components/workspace/editor-access-gate': `export function EditorAccessGate({children}){return children;}`,
  '@/components/workspace/project-draft': `export const takeFiles=async()=>[],acknowledgeDraftFiles=async()=>{};`,
  '@/lib/editor/prepare-video-audio': `export const prepareVideoAudio=async()=>{throw Error('Unexpected video preparation');},prepareAudioWaveform=async()=>{throw Error('Unexpected audio preparation');};`,
  './editor-shell': `import {useState} from 'react';import {useMediaFileDrop,MediaFileDropOverlay} from './components/editor/media-file-drop';import {PreviewInspector} from './components/editor/preview-inspector';
    export function EditorShell(props){window.editorProps=props;const [sourceRequest,setSourceRequest]=useState(0);const drop=useMediaFileDrop({busy:!!props.upload,onUpload:files=>{setSourceRequest(value=>value+1);return props.onDropUpload(files);},onError:props.onError});return <main className="editor-app" {...drop.handlers}><MediaFileDropOverlay active={drop.active} busy={!!props.upload}/><header id="header">Project</header><section id="chat"><span id="nested">Conversation</span></section><section id="preview">Preview</section><section id="timeline" onDrop={()=>window.internalDrops++}>Timeline</section><PreviewInspector sourceRequest={sourceRequest} clip={props.timeline.clips[0]} assets={props.assets} upload={props.upload} onUpload={()=>{}} onAdd={()=>{}} onChange={()=>{}} onCrop={()=>{}} onClose={()=>{}}/><output id="sources">{props.assets.map(a=>a.fileName).join(',')}</output><output id="error">{props.error}</output></main>;}`,
};
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import {createRoot} from 'react-dom/client';import {ConnectedEditor} from './components/editor/connected-editor';
    window.savedAssets=[];window.savedTimelines=[];window.internalDrops=0;
    window.XMLHttpRequest=class{upload={};open(){}setRequestHeader(){}send(blob){this.status=200;this.responseText=JSON.stringify({etag:'fixture',partNumber:1});queueMicrotask(()=>{this.upload.onprogress?.({loaded:blob.size});this.onload();});}};
    window.file=()=>new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'new-image.png',{type:'image/png'});
    window.drag=(selector,type,internal=false)=>{const dt=new DataTransfer();if(internal)dt.setData('revline/asset','internal-asset');else dt.items.add(window.file());return !document.querySelector(selector).dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));};
    createRoot(document.getElementById('root')).render(<ConnectedEditor projectId="fixture-project"/>);
  ` },
  plugins: [{name:'isolated-boundaries',setup(builder){
    builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}));
  }}],
  bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,outdir:'/tmp/revline-file-drop-fixture',define:{'process.env.NODE_ENV':'"production"'},
});
const script=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const html=`<!doctype html><title>Isolated editor file-drop verification</title><style>:root{--background:#171717;--foreground:#eee;--primary:#5d79ff;--muted-foreground:#aaa}body{margin:0;background:#171717;color:#eee;font:14px Arial}main{height:600px;display:grid;grid-template-columns:1fr 1fr}header,output{grid-column:1 / -1}section,header,output{padding:24px;border:1px solid #333}${css}</style><div id="root"></div><script src="/fixture.js"></script>`;
const server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':request.url==='/fixture.js'?'text/javascript':'text/html'});response.end(request.url==='/fixture.js'?script:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=768']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);await page.waitForSelector('#chat');
  const original=await page.evaluate(()=>JSON.stringify(window.editorProps.timeline));
  await page.click('.inspector-library-heading button');
  assert.equal(await page.$('#inspector-edit')!==null,true,'Begin with the editing controls open');
  await page.evaluate(()=>{window.drag('#chat','dragenter');window.drag('#nested','dragenter');window.drag('#chat','dragleave');});
  await page.waitForSelector('.editor-file-drop-overlay');
  assert.equal(await page.$eval('.editor-file-drop-overlay',el=>getComputedStyle(el).pointerEvents),'none');
  assert.equal(await page.$eval('.editor-file-drop-overlay strong',el=>el.textContent),'Drop files into Sources');
  await page.evaluate(()=>window.drag('#nested','drop'));
  await page.waitForFunction(()=>window.editorProps.assets.length===1&&!window.editorProps.upload);
  assert.equal(await page.$('.editor-file-drop-overlay'),null);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.editorProps.timeline)),original,'Dropping over chat preserves the complete timeline');
  assert.equal(await page.evaluate(()=>window.savedAssets.length),1);
  assert.equal(await page.$eval('#inspector-media .asset-card strong',el=>el.textContent),'new-image.png','A drop opens the actual Sources list');
  await page.type('[aria-label="Search sources"]','hidden');
  await page.evaluate(()=>{window.drag('#timeline','dragenter');window.drag('#timeline','drop');});
  await page.waitForFunction(()=>window.editorProps.assets.length===2&&!window.editorProps.upload);
  assert.equal(await page.evaluate(()=>window.internalDrops),0,'External files bypass nested timeline drop handlers');
  assert.equal(await page.$eval('[aria-label="Search sources"]',el=>el.value),'','Dropping again clears stale source filters');
  assert.equal(await page.$$eval('#inspector-media .asset-card',els=>els.length),2);
  assert.equal(await page.evaluate(()=>window.savedTimelines.length),0,'Sources-only upload never saves or inserts a clip');
  await page.evaluate(()=>{window.drag('#timeline','dragenter',true);window.drag('#timeline','drop',true);});
  assert.equal(await page.evaluate(()=>window.internalDrops),1,'Internal media drags reach their existing handler');
  assert.equal(await page.$('.editor-file-drop-overlay'),null);
  await page.evaluate(()=>{window.drag('#header','dragenter');window.drag('#header','dragleave');});
  assert.equal(await page.$('.editor-file-drop-overlay'),null,'Leaving the workspace clears the overlay');
  await page.evaluate(()=>{window.drag('#chat','dragenter');window.dispatchEvent(new Event('dragend'));});
  await page.waitForFunction(()=>!document.querySelector('.editor-file-drop-overlay'));
  await page.evaluate(()=>{window.holdUpload=true;window.drag('#header','drop');});
  await page.waitForFunction(()=>window.finishUpload);
  await page.evaluate(()=>{window.drag('#preview','dragenter');window.drag('#preview','drop');});
  await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('Wait for this upload'));
  await page.evaluate(()=>{window.holdUpload=false;window.finishUpload();});
  await page.waitForFunction(()=>window.editorProps.assets.length===3&&!window.editorProps.upload);
  assert.equal(await page.evaluate(()=>window.savedAssets.length),3,'Busy drops are rejected, not uploaded twice');
  await page.evaluate(()=>window.editorProps.onUpload([window.file()]));
  await page.waitForFunction(()=>window.editorProps.timeline.clips.length===2&&!window.editorProps.upload);
  assert.equal(await page.evaluate(()=>window.savedAssets.length),4,'The existing choose-files upload still works');
  assert.equal(await page.evaluate(()=>window.editorProps.timeline.clips.filter(c=>c.assetId).length),1,'Ordinary imports retain automatic clip insertion');
  assert.deepEqual(errors,[]);
  console.log('PASS: whole-editor Sources-only drops, nested drag cleanup, internal drags, busy guard, and ordinary import behavior.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
