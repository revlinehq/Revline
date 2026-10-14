import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ConnectedTimelineShareDialog} from './components/editor/timeline-share-dialog';
import {TimelineShowcase} from './components/editor/timeline-showcase';
import {EditorStateProvider} from './components/editor/editor-state';import {TimelinePanel} from './components/editor/timeline';
import {createEditorStore} from './lib/editor/store';import {TooltipProvider} from './components/ui/tooltip';
import './components/workspace/shared.css';import './components/workspace/workspace-pages.css';import './app/editor.css';
const shareId='j1234567890123456789012345678901';
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#a0cebf"/><path d="M0 360L260 0h140l240 360" fill="#cda76f"/><text x="35" y="280" fill="#fff" font-family="Arial" font-size="40">A synthetic shared edit</text></svg>');
const timeline={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:1,effects:1},markers:[{id:'beat',time:3,label:'A moment'}],clips:[{id:'image',kind:'image',assetId:'source',start:0,sourceStart:0,duration:12,track:1},{id:'title',kind:'caption',text:'My shared timeline',start:2,sourceStart:0,duration:5,track:2},{id:'bars',kind:'effect',effectPreset:'cinematic-bars',start:1,sourceStart:0,duration:9,track:1},{id:'audio',kind:'audio',assetId:'audio-source',start:0,sourceStart:0,duration:12,track:1,volume:1}]};
const assets=[{_id:'source',fileName:'Synthetic footage.svg',kind:'image',url:window.location.origin+'/fixture.svg',thumbnailUrl:image,width:640,height:360},{_id:'audio-source',fileName:'Synthetic audio',kind:'audio',url:window.location.origin+'/fixture.wav',duration:12,waveform:{peaks:btoa(String.fromCharCode(...Array.from({length:120},(_,i)=>Math.round(50+Math.sin(i)*30)))),samplesPerSecond:10}}];
const store=createEditorStore(timeline);window.fixtureStore=store;window.sourceTimeline=structuredClone(timeline);
let revision=0;const listeners=new Set();const notify=()=>{revision++;for(const listener of listeners)listener()};
window.mock={shareId,status:null,signedIn:false,publicReady:false,events:[],navigations:[],copied:'',subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},snapshot:()=>revision,notify,
 auth:()=>window.mock.signedIn,
 waitForSave:()=>new Promise(resolve=>{window.mock.events.push('save:start');window.mock.finishSave=()=>{window.mock.events.push('save:done');resolve()}}),
 query:name=>name==='timelineShares:status'?window.mock.status:!window.mock.publicReady?undefined:window.mock.status?.published?{_id:shareId,title:'Sunday edit',updatedAt:window.mock.status.updatedAt,timeline,assets}:null,
 run:async(name,args)=>{window.mock.events.push(name);window.mock.lastArgs=args;
  if(name==='timelineShares:publish'){if(window.mock.failPublish)throw new Error('Synthetic publishing failure');window.mock.status={_id:shareId,title:'Sunday edit',published:true,updatedAt:Date.now()};notify();return shareId}
  if(name==='timelineShares:revoke'){window.mock.status={...window.mock.status,published:false,updatedAt:Date.now()};notify();return null}
  if(name==='timelineShares:useTimeline'){await new Promise((resolve,reject)=>{window.mock.finishCopy=resolve;window.mock.failCopy=()=>reject(new Error('Synthetic copy failure'))});return 'new-editable-project'}
 }};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.mock.failClipboard)throw new Error('Synthetic clipboard failure');window.mock.copied=text}}});
function Fixture(){const[open,setOpen]=useState(false),[mode,setMode]=useState('owner');window.showMode=setMode;window.openShare=()=>setOpen(true);return <TooltipProvider>{mode==='owner'?<div className="fixture-owner conversation-editor"><button onClick={()=>setOpen(true)}>Share timeline</button><ConnectedTimelineShareDialog projectId="fixture-project" open={open} onOpenChange={setOpen} title="Sunday edit" timeline={timeline} assets={assets} onBeforePublish={window.mock.waitForSave}/></div>:mode==='public'?<TimelineShowcase shareId={shareId}/>:<div className="timeline-showcase conversation-editor editor-app"><EditorStateProvider store={store}><TimelinePanel readOnly timeline={timeline} assets={assets} selected={null} onSelect={()=>{}} time={0} playing={false} onSeek={time=>{window.mock.seek=time}} onChange={()=>window.mock.events.push('ILLEGAL EDIT')} onSplit={()=>window.mock.events.push('ILLEGAL SPLIT')} onDelete={()=>window.mock.events.push('ILLEGAL DELETE')} onDuplicate={()=>window.mock.events.push('ILLEGAL DUPLICATE')} onAddText={()=>window.mock.events.push('ILLEGAL TEXT')}/></EditorStateProvider></div>}</TooltipProvider>};
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const mockModules = {
  'convex/react': `import {useSyncExternalStore} from 'react';import {getFunctionName} from 'convex/server';export function useQuery(fn,args){useSyncExternalStore(window.mock.subscribe,window.mock.snapshot);return args==='skip'?undefined:window.mock.query(getFunctionName(fn))}export function useMutation(fn){return args=>window.mock.run(getFunctionName(fn),args)}export function useConvexAuth(){useSyncExternalStore(window.mock.subscribe,window.mock.auth);return {isAuthenticated:window.mock.signedIn,isLoading:false}}`,
  '@clerk/nextjs': `import {useSyncExternalStore} from 'react';export function useAuth(){useSyncExternalStore(window.mock.subscribe,window.mock.auth);return {isLoaded:true,isSignedIn:window.mock.signedIn}}`,
  'next/navigation': `export function useRouter(){return {push:url=>window.mock.navigations.push(url)}}`,
  'next/link': `import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}`,
};
const bundle = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', write: false, outdir: '/tmp/revline-sharing-fixture', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'synthetic-backend', setup(build) {
  build.onResolve({ filter: /^(convex\/react|@clerk\/nextjs|next\/navigation|next\/link)$/ }, args => ({ path: args.path, namespace: 'mock' }));
  build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mockModules[args.path], loader: 'js', resolveDir: process.cwd() }));
} }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text, css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const audio = Buffer.alloc(44 + 12 * 8000 * 2);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://fixture').pathname;
  try {
    if (path === '/fixture.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#a0cebf"/><path d="M0 360L260 0h140l240 360" fill="#cda76f"/><text x="35" y="280" fill="#fff" font-family="Arial" font-size="40">A synthetic shared edit</text></svg>'); }
    else if (path === '/fixture.wav') { response.setHeader('Content-Type', 'audio/wav'); response.end(audio); }
    else if (path.startsWith('/vendor/') || path.startsWith('/fonts/')) { response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'font/woff2'); response.end(await readFile(join(process.cwd(), 'public', path))); }
    else if (path === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); }
    else if (path === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<html data-workspace-theme="dark"><head><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;font:12px Arial;background:var(--ws-bg);color:var(--ws-text)}button{font-family:inherit;border:0;background:transparent;color:inherit}.fixture-owner{min-height:100vh;padding:28px;background:var(--ws-bg)}.timeline-share-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:50}[data-slot=dialog-overlay]{position:fixed;inset:0;background:#0008;z-index:49}.timeline-share-dialog [data-slot=dialog-close]{position:absolute;top:10px;right:10px;display:grid;place-items:center;width:28px;height:28px}.fixture-owner>button{background:var(--ws-surface);color:var(--ws-text);border:0;border-radius:6px;padding:10px 18px}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
  } catch { response.statusCode = 404; response.end('Fixture resource not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
const page = await browser.newPage(), errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Synthetic sharing fixture:',error.message); }); page.setDefaultTimeout(15_000);
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const button = name => page.locator(`::-p-aria([name="${name}"][role="button"])`);
try {
  await page.setViewport({ width: 1440, height: 960 }); await page.goto(`${origin}/editor/showcase/fixture`);
  await button('Share timeline').click(); await page.waitForSelector('[role="dialog"]');
  assert.equal(await page.$('[aria-label="Timeline sharing link"]'), null, 'Opening the dialog does not publish');
  await button('Create link').click(); await flush();
  assert.deepEqual(await page.evaluate(() => window.mock.events), ['save:start'], 'Publishing waits for saved edits');
  await page.evaluate(() => window.mock.finishSave()); await page.waitForSelector('[aria-label="Timeline sharing link"]');
  assert.deepEqual(await page.evaluate(() => window.mock.events), ['save:start', 'save:done', 'timelineShares:publish']);
  const link = await page.$eval('[aria-label="Timeline sharing link"]', input => input.value);
  assert.equal(link, `${origin}/editor/showcase/j1234567890123456789012345678901`);
  await button('Copy link').click(); await page.waitForFunction(() => window.mock.copied.length > 0);
  assert.equal(await page.evaluate(() => window.mock.copied), link);
  assert.equal(await page.$eval('.timeline-share-actions a', link => link.href), link);
  assert.ok(await page.$('.timeline-share-link .revline-primary'), 'Copy uses the shared blue primary button');
  await page.screenshot({ path: '/tmp/revline-timeline-share-dialog-dark.png' });
  await page.evaluate(() => { window.mock.failClipboard = true; }); await button('Copied').click(); await page.waitForSelector('[role="alert"]');
  assert.match(await page.$eval('[role="alert"]', node => node.textContent), /copy.*manually/);
  await button('Turn off sharing').click(); await page.waitForFunction(() => !window.mock.status.published);
  assert.equal(await page.$('[aria-label="Timeline sharing link"]'), null, 'Revocation removes the link');
  await page.evaluate(() => { window.mock.failPublish = true; }); await button('Create link').click(); await page.evaluate(() => window.mock.finishSave()); await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('publishing failure'));
  await page.evaluate(() => { window.mock.failPublish = false; window.mock.failClipboard = false; }); await button('Create link').click(); await page.evaluate(() => window.mock.finishSave()); await page.waitForSelector('[aria-label="Timeline sharing link"]');
  await page.setViewport({ width: 390, height: 844 }); await flush();
  assert.ok(await page.$eval('[role="dialog"]', dialog => dialog.getBoundingClientRect().width <= window.innerWidth - 28), 'Sharing fits a phone');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.evaluate(() => window.showMode('public')); await page.waitForSelector('.timeline-showcase-loading');
  await page.evaluate(() => { window.mock.publicReady = true; window.mock.notify(); }); await page.waitForSelector('.timeline-showcase-layout');
  await page.setViewport({ width: 1440, height: 960 });
  await page.waitForFunction(() => document.querySelector('.timeline-showcase-playback')?.disabled === false, { timeout: 20_000 });
  assert.equal(await page.$('.assistant-panel,.effect-library,.clip-trim,.audio-volume-line,.layer-options'), null, 'Public viewing exposes no editor controls');
  for (const label of ['Split selected clip', 'Add caption', 'Delete selected clips', 'Add timeline layer', 'Toggle snapping', 'Volume for A1']) assert.equal(await page.$(`[aria-label="${label}"]`), null);
  await button('Play (Space)').click(); await page.waitForSelector('[aria-label="Pause (Space)"]');
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.currentTime > .2);
  await button('Pause (Space)').click(); await button('Next cut').click();
  await page.waitForFunction(() => Math.abs(document.querySelector('hyperframes-player')?.currentTime - 1) < .05);
  await page.focus('.custom-timeline'); await page.keyboard.press('Space'); await page.waitForSelector('[aria-label="Pause (Space)"]'); await page.keyboard.press('Space'); await page.waitForSelector('[aria-label="Play (Space)"]');
  await page.screenshot({ path: '/tmp/revline-timeline-showcase-dark.png' });
  const useCalls = await page.evaluate(() => window.mock.events.filter(name => name === 'timelineShares:useTimeline').length);
  await button('Use timeline').click(); await flush();
  assert.equal(await page.evaluate(() => window.mock.events.filter(name => name === 'timelineShares:useTimeline').length), useCalls, 'Anonymous use cannot mutate');
  assert.equal(await page.evaluate(() => window.mock.navigations.at(-1)), '/sign-in?redirect_url=%2Feditor%2Fshowcase%2Fj1234567890123456789012345678901');
  await page.evaluate(() => { window.mock.signedIn = true; window.mock.notify(); }); await flush();
  await button('Use timeline').click(); await page.waitForSelector('.timeline-copy-loading');
  assert.match(await page.$eval('.timeline-copy-loading', node => node.textContent), /Creating your copy…/);
  assert.equal(await page.$('progress'), null, 'Copying has no invented percentages');
  await page.screenshot({ path: '/tmp/revline-timeline-copy-loading-dark.png' });
  await page.evaluate(() => window.mock.failCopy()); await page.waitForSelector('.timeline-showcase-layout');
  assert.match(await page.$eval('[role="alert"]', node => node.textContent), /copy failure/);
  await button('Use timeline').click(); await page.waitForSelector('.timeline-copy-loading'); await page.evaluate(() => window.mock.finishCopy()); await flush();
  assert.equal(await page.evaluate(() => window.mock.navigations.at(-1)), '/editor/new-editable-project');
  await page.evaluate(() => window.showMode('readonly')); await page.waitForSelector('[data-read-only]');
  const clip = await page.$('[data-clip-id="image"]'), box = await clip.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 180, box.y + 45, { steps: 5 }); await page.mouse.up();
  await page.focus('[data-clip-id="title"]'); await page.keyboard.press('Enter'); await page.keyboard.press('Delete'); await page.keyboard.press('Backspace');
  await page.click('[data-marker-id="beat"]'); await page.keyboard.press('Delete'); await page.keyboard.press('ArrowRight');
  await page.evaluate(() => { const transfer = new DataTransfer(); transfer.setData('revline/asset', 'source'); const track = document.querySelector('.timeline-track[data-group="visual"]'); track.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer })); track.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); });
  await page.mouse.click(box.x + 50, box.y + 20, { button: 'right' }); await flush();
  assert.equal(await page.$('[role="menu"]'), null, 'Read-only clips cannot open edit menus');
  assert.equal(await page.evaluate(() => window.mock.events.some(name => name.startsWith('ILLEGAL'))), false, 'No edit callback runs from pointer, keys or drops');
  assert.deepEqual(await page.evaluate(() => window.fixtureStore.getState().timeline), await page.evaluate(() => window.sourceTimeline));
  assert.equal(await page.evaluate(() => window.mock.seek), 3, 'Read-only marker activation still seeks');
  const zoom = await page.$eval('[aria-label="Timeline zoom"]', input => input.value); await button('Zoom in').click(); await flush(); assert.notEqual(await page.$eval('[aria-label="Timeline zoom"]', input => input.value), zoom);
  await page.evaluate(() => { window.mock.status = { ...window.mock.status, published: false }; window.mock.notify(); window.showMode('public'); }); await page.waitForSelector('.timeline-showcase-unavailable');
  assert.deepEqual(errors, []);
  console.log('PASS: saved snapshot before publish, copy/open link, revoke and provider failures, phone dialog; public real preview/timeline; no editing via pointer/keyboard/drop/context; seek and zoom; sign-in backlink, creating-copy state and copied-project navigation; revoked link unavailable. Mock backend and synthetic media only.');
} catch (error) {
  await page.screenshot({ path: '/tmp/revline-timeline-sharing-failure.png' });
  console.error(await page.evaluate(() => ({ alert: document.querySelector('[role="alert"]')?.textContent, previewBounds: document.querySelector('.preview-canvas')?.getBoundingClientRect().toJSON(), viewportBounds: document.querySelector('.preview-viewport')?.getBoundingClientRect().toJSON(), frames: document.querySelectorAll('iframe').length, players: [...document.querySelectorAll('hyperframes-player,hyperframes-player-element,hyperframes-player-web')].map(player => ({ tag: player.tagName, painted: player.painted, duration: player.duration })) })));
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
