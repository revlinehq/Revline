import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import puppeteer from 'puppeteer';

// Exercise the real project, access, and asset gates without bundling playback.
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ConnectedEditor} from './components/editor/connected-editor';
import {EditorAccessGate} from './components/workspace/editor-access-gate';
import {EMPTY_TIMELINE} from './lib/editor/types';
import './components/workspace/workspace-pages.css';import './app/editor.css';
let revision=0;const listeners=new Set();
window.mock={project:undefined,billing:undefined,assets:undefined,events:[],
 subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},snapshot:()=>revision,
 notify:()=>{revision++;for(const listener of listeners)listener()},
 query:name=>name==='projects:get'?window.mock.project:name==='billing:status'?window.mock.billing:name==='assets:list'?window.mock.assets:name==='assistant:status'?{running:false,configured:true}:[],
 run:async(name,args)=>{window.mock.events.push({name,args});return {url:null}},
 projectFor:id=>({_id:id,_creationTime:0,title:'Synthetic chat',aspectRatio:'landscape',timeline:EMPTY_TIMELINE,revision:0}),
};
function Fixture(){const[projectId,setProjectId]=useState('first-chat'),[mode,setMode]=useState('connected');window.switchChat=setProjectId;window.showMode=setMode;return mode==='connected'?<ConnectedEditor projectId={projectId}/>:<EditorAccessGate><div data-testid="gate-child">Plan accepted</div></EditorAccessGate>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const mocks = {
  'convex/react': `import {useSyncExternalStore} from 'react';import {getFunctionName} from 'convex/server';const client={query:async fn=>window.mock.query(getFunctionName(fn)),mutation:async(fn,args)=>window.mock.run(getFunctionName(fn),args)};export function useConvex(){return client}export function useQuery(fn,args){useSyncExternalStore(window.mock.subscribe,window.mock.snapshot);return args==='skip'?undefined:window.mock.query(getFunctionName(fn))}export function useMutation(fn){return args=>window.mock.run(getFunctionName(fn),args)}export const useAction=useMutation;export function useConvexAuth(){return {isAuthenticated:true,isLoading:false}}`,
  '@convex-dev/agent/react': `export function useUIMessages(){return {results:[],status:'Exhausted',loadMore(){}}}`,
  'editor-shell': `import React from 'react';export function EditorShell({projectId}){return <div data-testid="ready-editor">Ready: {projectId}</div>}`,
  'timeline-share-dialog': `export function ConnectedTimelineShareDialog(){return null}`,
  'workspace-nav': `import React from 'react';export function WorkspaceNav(){return <nav aria-label="Workspace">Revline</nav>}`,
  'project-draft': `export async function takeFiles(){return []}export async function acknowledgeDraftFiles(){}`,
  'upload-source': `export async function uploadSourceFile(){throw new Error('Uploads are outside this fixture')}`,
};
const bundle = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', write: false, outdir: '/tmp/revline-editor-loading-fixture', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'scoped-editor-fixture', setup(build) {
  build.onResolve({ filter: /^(convex\/react|@convex-dev\/agent\/react)$/ }, args => ({ path: args.path, namespace: 'mock' }));
  build.onResolve({ filter: /(?:^|\/)(editor-shell|timeline-share-dialog|workspace-nav|project-draft|upload-source)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'mock' }));
  build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: process.cwd() }));
} }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const server = createServer((request,response) => {
  if (request.url === '/fixture.js') { response.setHeader('Content-Type','text/javascript'); response.end(js); }
  else if (request.url === '/fixture.css') { response.setHeader('Content-Type','text/css'); response.end(css); }
  else { response.setHeader('Content-Type','text/html'); response.end('<html data-workspace-theme="dark"><head><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;font:12px Arial;background:var(--ws-bg);color:var(--ws-text)}button{font-family:inherit}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=512']});
const page = await browser.newPage(), errors=[];
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10_000);
const flush = () => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function snapshotLoading(stage) {
  await flush();
  const view = await page.evaluate(()=>{
    const loading=document.querySelector('.footage-preparation');
    return {count:document.querySelectorAll('.footage-preparation').length,text:loading?.textContent,rect:loading?.getBoundingClientRect().toJSON(),background:loading&&getComputedStyle(loading).backgroundColor,status:loading?.querySelector('[role="status"]')?.textContent,planLoading:!!document.querySelector('.editor-access-loading'),ready:!!document.querySelector('[data-testid="ready-editor"]'),billing:!!document.querySelector('.editor-access-card')};
  });
  assert.equal(view.count,1,`${stage}: exactly one footage preparation screen`);
  assert.equal(view.planLoading,false,`${stage}: no separate plan-check screen flashes`);
  assert.equal(view.ready,false,`${stage}: editor stays hidden until data is ready`);
  assert.equal(view.billing,false,`${stage}: unresolved billing does not show denial`);
  assert.match(view.status,/Preparing footage…/);
  return {text:view.text,rect:view.rect,background:view.background,status:view.status};
}
async function setState(state) { await page.evaluate(state=>{Object.assign(window.mock,state);window.mock.notify()},state);await flush(); }
const subscribed={enabled:true,subscribed:true,configured:true,trialEligible:false,needsPayment:false};
try {
  await page.setViewport({width:1280,height:800});await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForSelector('.footage-preparation');
  const projectPending=await snapshotLoading('project pending');
  await page.evaluate(()=>{window.mock.project=window.mock.projectFor('first-chat');window.mock.notify()});
  assert.deepEqual(await snapshotLoading('billing pending'),projectPending,'Project and plan loading keep the same message, geometry, and surface');
  await setState({billing:subscribed});
  assert.deepEqual(await snapshotLoading('assets pending'),projectPending,'Plan and asset loading keep the same message, geometry, and surface');
  await setState({assets:[]});await page.waitForSelector('[data-testid="ready-editor"]');
  assert.equal(await page.$('.footage-preparation,.editor-access-loading,.editor-access-card'),null);
  assert.match(await page.$eval('[data-testid="ready-editor"]',node=>node.textContent),/first-chat/);

  // A new chat repeats the pending states without exposing the previous editor.
  await page.evaluate(()=>{window.mock.project=undefined;window.mock.billing=undefined;window.mock.assets=undefined;window.switchChat('second-chat');window.mock.notify()});
  assert.deepEqual(await snapshotLoading('switched project pending'),projectPending);
  await page.evaluate(()=>{window.mock.project=window.mock.projectFor('second-chat');window.mock.notify()});
  assert.deepEqual(await snapshotLoading('switched billing pending'),projectPending);
  await setState({billing:subscribed});
  assert.deepEqual(await snapshotLoading('switched assets pending'),projectPending);
  await setState({assets:[]});await page.waitForFunction(()=>document.querySelector('[data-testid="ready-editor"]')?.textContent.includes('second-chat'));

  // Pending customization never bypasses the actual denial or payment controls.
  await setState({billing:{...subscribed,subscribed:false,trialEligible:true}});await page.waitForSelector('.editor-access-card');
  assert.match(await page.$eval('#editor-access-title',node=>node.textContent),/Try Revline free/);
  assert.ok(await page.$('.editor-access-start:not(:disabled)'));
  assert.equal(await page.$('.footage-preparation,[data-testid="ready-editor"]'),null);
  await setState({billing:{...subscribed,subscribed:false,needsPayment:true}});
  assert.equal(await page.$eval('#editor-access-title',node=>node.textContent),'Update your payment method');
  assert.match(await page.$eval('.editor-access-start',node=>node.textContent),/Update payment method/);
  await setState({billing:{...subscribed,subscribed:false,configured:false}});
  assert.equal(await page.$eval('.editor-access-start',node=>node.disabled),true);
  assert.match(await page.$eval('.editor-access-card',node=>node.textContent),/Billing is temporarily unavailable/);
  await setState({billing:{...subscribed,enabled:false,subscribed:false}});await page.waitForSelector('[data-testid="ready-editor"]');

  // Existing callers without a custom fallback retain the generic pending UI.
  await page.evaluate(()=>{window.mock.billing=undefined;window.showMode('defaultGate');window.mock.notify()});
  await page.waitForSelector('.editor-access-loading');
  assert.match(await page.$eval('.editor-access-loading',node=>node.textContent),/Checking your plan…/);
  assert.equal(await page.$('[data-testid="gate-child"]'),null);
  await setState({billing:subscribed});await page.waitForSelector('[data-testid="gate-child"]');
  assert.deepEqual(await page.evaluate(()=>window.mock.events),[],'Loading and denial do not trigger mutations or billing actions');
  assert.deepEqual(errors,[]);
  console.log('PASS: real ConnectedEditor project → billing → assets loading stays visually identical across chat switches; ready editor appears only after data; trial/payment/unavailable denials retained; billing-disabled and subscribed access accepted; default gate fallback preserved. Synthetic backend, no playback bundle or writes.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
