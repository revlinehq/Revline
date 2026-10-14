import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// Real shell, inspector, edit validation and store; no media/provider/network calls.
const stubs = {
  'next/navigation': `const params=new URLSearchParams();export const useSearchParams=()=>params;`,
  '@/components/workspace/workspace-nav': `import React from 'react';export const WorkspaceNav=p=><header>{p.editorControls}</header>;`,
  './preview': `import React,{forwardRef,useImperativeHandle} from 'react';export const Preview=forwardRef(function Preview(p,ref){useImperativeHandle(ref,()=>({currentTime:()=>0,seek:()=>{},pause:()=>{},play:()=>{},mute:()=>{},clipEffects:()=>{}}));return <div>Retained preview</div>});`,
  './media-import-dialog': `export const MediaImportDialog=()=>null;`,
  './assistant-panel': `export const AssistantPanel=()=>null;`,
};
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {useStore} from 'zustand';import {TooltipProvider} from './components/ui/tooltip';import {EditorShell} from './components/editor/editor-shell';import {EditorStateProvider} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';import {addTransitionClip,deleteClip} from './lib/editor/operations';import './app/editor.css';import './components/workspace/workspace-pages.css';
const initial=addTransitionClip({fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[{id:'a',kind:'image',track:1,start:0,duration:3,sourceStart:0},{id:'b',kind:'image',track:1,start:3,duration:3,sourceStart:0}]},'fade','crossfade','a','b'),store=createEditorStore(initial);store.setState({selectedId:'a',selectedIds:['a']});window.fixture={store,removeTransition:()=>store.getState().edit(deleteClip(store.getState().timeline,'fade'))};window.notices=[];
function Fixture(){const timeline=useStore(store,s=>s.timeline),[error,setError]=useState('');return <TooltipProvider><EditorStateProvider store={store}><EditorShell workspaceOnly title="Joined footage" timeline={timeline} assets={[]} onChange={next=>store.getState().edit(next)} onTitle={()=>{}} onUpload={async()=>{}} onDropUpload={async()=>{}} saving={false} upload={null} error={error} onError={message=>{window.notices.push(message);setError(message)}} onUndo={()=>store.getState().undo()} onRedo={()=>store.getState().redo()} canUndo canRedo messages={[]} aiRunning={false} aiConfigured={false} onSend={async()=>{}} onExport={async()=>{}} exportState={null} demo/></EditorStateProvider></TooltipProvider>};createRoot(document.getElementById('root')).render(<Fixture/>);
` }, plugins: [{ name: 'fixture-boundaries', setup(builder) {
  builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: process.cwd() }));
} }], bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', write: false, outdir: '/tmp/revline-blend-rejection', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage(), errors = [];page.setDefaultTimeout(5000);page.on('pageerror', error => errors.push(error.message));
  const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.setViewport({ width:1440, height:900 });await page.setContent('<html data-workspace-theme="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});await page.addStyleTag({content:'body{margin:0;font:12px Arial;background:#171717}*{box-sizing:border-box}.editor-app{height:900px}header{height:54px;flex-shrink:0}'});await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await page.waitForSelector('[data-clip-id="a"]');await page.$eval('[data-clip-id="a"]',node=>node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));await page.waitForSelector('[data-blend-mode="screen"]');
  const before=await page.evaluate(()=>window.fixture.store.getState().timeline);
  await page.click('[data-blend-mode="screen"]');await flush();
  assert.deepEqual(errors,[], 'A rejected blend edit must not escape the click handler as a Runtime Error');
  assert.match(await page.$eval('[role="alert"]',node=>node.textContent),/same blend mode/i);
  assert.deepEqual(await page.evaluate(()=>window.fixture.store.getState().timeline),before,'Rejected edit preserves both clips and the transition');
  assert.equal(await page.evaluate(()=>window.fixture.store.getState().history.length),0,'Rejected edit adds no Undo/save');
  assert.equal(await page.$eval('[data-blend-mode="normal"]',node=>node.getAttribute('aria-pressed')),'true');
  await page.click('[aria-label="Dismiss error"]');await flush();
  await page.setViewport({width:800,height:900});await flush();await page.$eval('[data-clip-id="a"]',node=>node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));await page.waitForSelector('.preview-inspector-sheet [data-blend-mode="multiply"]');await page.click('.preview-inspector-sheet [data-blend-mode="multiply"]');await flush();
  assert.deepEqual(errors,[], 'The responsive inspector must use the same safe edit handler');
  assert.deepEqual(await page.evaluate(()=>window.fixture.store.getState().timeline),before);
  await page.evaluate(()=>window.fixture.removeTransition());await flush();await page.click('.preview-inspector-sheet [data-blend-mode="screen"]');await flush();
  assert.equal(await page.evaluate(()=>window.fixture.store.getState().timeline.clips.find(c=>c.id==='a').blendMode),'screen','Legal blend edits still save');
  await page.evaluate(()=>window.fixture.store.getState().undo());await flush();assert.equal(await page.evaluate(()=>window.fixture.store.getState().timeline.clips.find(c=>c.id==='a').blendMode),undefined);
  assert.deepEqual(errors,[]);console.log('PASS: desktop/mobile joined-clip blend rejection stays recoverable, preserves timeline/history, and legal edits still save/undo.');
} finally { await browser.close(); }
