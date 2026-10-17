import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import puppeteer from 'puppeteer';

// Real chat/composer/scroll code with a synthetic subscription. No model calls.
const subscription = `import {useEffect,useState} from 'react';export function useUIMessages(){const[,update]=useState(0);useEffect(()=>{window.remoteChanged=()=>update(value=>value+1);return()=>{window.remoteChanged=null}},[]);return {results:window.remoteMessages??[],status:'Exhausted',loadMore:()=>{}}}`;
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {AssistantPanel} from './components/editor/assistant-panel';
import './components/workspace/shared.css';import './components/workspace/workspace-pages.css';import './app/editor.css';
function Fixture(){const[state,setState]=useState({messages:[],running:false,conversation:undefined,error:null,suggestions:undefined,attachments:undefined});window.fixture={update:patch=>setState(current=>({...current,...patch})),remote:messages=>{window.remoteMessages=messages;window.remoteChanged?.()}};return <AssistantPanel {...state} configured hasClips demo={false} onSuggestion={async()=>{}} onSend={text=>{window.sent=text;return new Promise(resolve=>window.accept=resolve)}}/>};createRoot(document.getElementById('root')).render(<Fixture/>);
` }, plugins: [{ name: 'synthetic-conversation', setup(builder) {
 builder.onResolve({ filter: /^@convex-dev\/agent\/react$/ }, args => ({ path: args.path, namespace: 'fixture' }));
 builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: subscription, loader: 'tsx', resolveDir: process.cwd() }));
} }], bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-first-message', define: { 'process.env.NODE_ENV': '"production"' } });
const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<html data-workspace-theme="dark"><body><main class="conversation-editor"><div id="root"></div></main></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
 const page = await browser.newPage(), errors = [];
 page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
 await page.setViewport({ width: 440, height: 760 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
 await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;font:13px Arial;background:var(--ws-bg);color:var(--ws-text)}#root{width:360px;height:650px;margin:24px auto;display:flex}p{margin:0}' });
 await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
 await page.waitForSelector('textarea'); await page.type('textarea', 'Make the opening tighter.'); await page.keyboard.press('Enter');
 await page.waitForSelector('.chat-user');
 await page.evaluate(() => { window.panel = document.querySelector('.assistant-content'); window.composer = document.querySelector('textarea'); window.fixture.update({ conversation: { projectId: 'project', threadId: 'first-thread' }, running: true }); });
 await page.waitForFunction(() => !!window.remoteChanged);
 assert.equal(await page.evaluate(() => window.panel === document.querySelector('.assistant-content')), true, 'Creating the first server conversation must keep the existing chat DOM');
 assert.equal(await page.evaluate(() => window.composer === document.querySelector('textarea')), true, 'First-message subscription must preserve the composer');
 assert.equal(await page.$eval('.chat-user', node => node.textContent), 'Make the opening tighter.', 'Optimistic first message stays visible while the server history loads');
 assert.equal(await page.$('.assistant-welcome'), null);
 await page.evaluate(() => { window.fixture.remote([{ id: 'saved-user', key: 'saved-user', role: 'user', order: 0, stepOrder: 0, parts: [{ type: 'text', text: 'Make the opening tighter.' }], status: 'success' }]); window.accept(); });
 await page.waitForFunction(() => document.querySelectorAll('.chat-user').length === 1);
 assert.equal(await page.evaluate(() => window.panel === document.querySelector('.assistant-content')), true);

 const messages = Array.from({ length: 5 }, (_, index) => [{ id: `u${index}`, role: 'user', text: `Request ${index}` }, { id: `a${index}`, role: 'assistant', text: 'Your edit is ready. '.repeat(12), status: 'success' }]).flat();
 await page.evaluate(messages => window.fixture.update({ conversation: undefined, messages, running: false }), messages);
 await page.waitForSelector('[data-message-id="a4"]');
 await page.evaluate(() => window.fixture.update({ suggestions: { sourceName: 'Selected footage', clipId: 'clip', items: Array.from({ length: 3 }, (_, index) => ({ label: `Try suggestion ${index}`, prompt: 'Improve this moment', start: index, end: index + 1 })) } }));
 const visible = selector => page.waitForFunction(selector => { const target = document.querySelector(selector), viewport = document.querySelector('.assistant-history'); if (!target || !viewport) return false; const box = target.getBoundingClientRect(), bounds = viewport.getBoundingClientRect(); return box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1; }, {}, selector);
 await visible('.assistant-source-suggestions button:last-child');
 await page.evaluate(() => window.fixture.update({ error: 'The request could not finish. Your existing edit is still saved. Please try again.' }));
 await visible('.chat-error');
 await page.$eval('.assistant-history', node => { node.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 })); node.scrollTop = 0; });
 await page.evaluate(() => window.fixture.update({ error: 'The request could not finish. '.repeat(8) }));
 await new Promise(resolve => setTimeout(resolve, 150));
 assert.equal(await page.$eval('.assistant-history', node => node.scrollTop), 0, 'New errors must preserve deliberate reading of older messages');
 await page.evaluate(() => window.fixture.update({ attachments: Array.from({ length: 3 }, (_, index) => ({ id: `media${index}`, name: `Footage${index}.mp4`, kind: 'video' })) }));
 await page.waitForSelector('.composer-attachment>span');
 for (const width of [440, 360]) {
  await page.setViewport({ width, height: 760 });
  assert.deepEqual(await page.$$eval('textarea,.composer-attachment>span,.composer-more,.composer-submit', nodes => [...new Set(nodes.map(node => getComputedStyle(node).fontSize))]), ['14px'], 'Input, attachment filenames and composer controls all share14px');
  assert.equal(await page.$eval('.manual-editor-composer', node => { const input = node.querySelector('textarea').getBoundingClientRect(), actions = node.querySelector('.edit-composer-actions').getBoundingClientRect(); return input.height >= 44 && actions.top - input.bottom >= 11; }), true, 'Composer keeps a dedicated input floor with breathing room above the controls');
 }
 assert.deepEqual(errors, []);
 await page.screenshot({ path: '/tmp/revline-chat-first-message.png' });
 console.log('PASS: first-send subscription preserves chat/composer DOM and optimistic message; suggestions/errors follow into view while historical reading stays put; composer14px desktop/mobile.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
