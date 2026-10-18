import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import puppeteer from 'puppeteer';

// Synthetic view-only fixture. No provider requests or saved account data.
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {AiCostReportView} from './components/workspace/ai-cost-report';
import './components/workspace/workspace-pages.css';
function Fixture(){const[days,setDays]=useState(7),[state,setState]=useState('ready');window.setFixtureState=setState;
const daily=Array.from({length:days},(_,i)=>({date:new Date(Date.UTC(2026,9,19-days+i)).toISOString().slice(0,10),knownEstimatedUsd:i%5*.0213,callCount:i%5*2,unknownCostCalls:0}));
const report={period:{start:0,end:1,days,timeZone:'America/New_York'},summary:{knownEstimatedUsd:.1146,callCount:7,unknownCostCalls:1,unreportedRuns:1,runCount:2,inputTokens:10900,outputTokens:3200,reasoningTokens:1800,toolCallCount:8},daily,breakdown:[{model:'gpt-6.1-sol',provider:'openai',reasoningEffort:'medium',speedMode:'fast',serviceTier:'default',knownEstimatedUsd:.1146,callCount:6,unknownCostCalls:0,inputTokens:10900,outputTokens:3200,reasoningTokens:1800,toolCallCount:8},{model:null,provider:null,reasoningEffort:null,speedMode:null,serviceTier:null,knownEstimatedUsd:0,callCount:1,unknownCostCalls:1,inputTokens:0,outputTokens:0,reasoningTokens:0,toolCallCount:0}],truncated:false,recordingSince:Date.UTC(2026,9,18)};
return <div className="workspace-page"><main className="workspace-profile-content"><div className="workspace-page-heading"><h1>Your profile</h1><p>Synthetic cost report preview</p></div><AiCostReportView report={state==='loading'?undefined:state==='disabled'?null:state==='empty'?{...report,summary:{...report.summary,callCount:0,knownEstimatedUsd:0},breakdown:[],recordingSince:null}:report} days={days} onDaysChange={setDays}/></main></div>};createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const bundle = await build({ stdin:{ contents:fixture,resolveDir:process.cwd(),loader:'tsx' },bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,outdir:'/tmp/revline-cost-fixture',define:{'process.env.NODE_ENV':'"production"'} });
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server=createServer((request,response)=>{ if(request.url==='/fixture.js'){response.setHeader('Content-Type','text/javascript');response.end(js)}else if(request.url==='/fixture.css'){response.setHeader('Content-Type','text/css');response.end(css)}else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}button{font-family:inherit}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=512']});
const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
try{
  await page.setViewport({width:1440,height:1050});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('.ai-cost-chart');
  assert.equal(await page.$$eval('.ai-cost-day',nodes=>nodes.length),7);
  await page.locator('.ai-cost-day:nth-child(2)').click();assert.equal(await page.$eval('.ai-cost-day:nth-child(2)',node=>node.getAttribute('aria-pressed')),'true');
  await page.locator('::-p-aria([name="30 days"][role="button"])').click();await flush();assert.equal(await page.$$eval('.ai-cost-day',nodes=>nodes.length),30);
  assert.equal(await page.$eval('.ai-cost-chart',node=>node.textContent.includes('\\u00a0')),false);
  await page.screenshot({path:'/tmp/profile-ai-cost-desktop.png',fullPage:true});
  for(const theme of ['light','dark']){await page.setViewport({width:360,height:850});await page.evaluate(theme=>document.documentElement.dataset.workspaceTheme=theme,theme);await flush();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`${theme}: report must not overflow phone viewport`);
    assert.equal(await page.$eval('.ai-cost-chart-scroll',node=>node.scrollWidth>node.clientWidth),true,'30-day chart scrolls inside its container');
    await page.$eval('.ai-cost-chart-scroll',node=>node.scrollLeft=node.scrollWidth);await page.locator('.ai-cost-day:last-child').click();
    await page.screenshot({path:`/tmp/profile-ai-cost-mobile-${theme}.png`,fullPage:true});
  }
  await page.locator('::-p-aria([name="7 days"][role="button"])').click();await flush();assert.equal(await page.$$eval('.ai-cost-day',nodes=>nodes.length),7);
  await page.evaluate(()=>window.setFixtureState('empty'));await flush();assert.equal(await page.$('.ai-cost-chart'),null);assert.match(await page.$eval('.ai-cost-notice',node=>node.textContent),/No model calls recorded/);
  await page.evaluate(()=>window.setFixtureState('loading'));await flush();assert.match(await page.$eval('[role="status"]',node=>node.textContent),/Loading recorded costs/);
  await page.evaluate(()=>window.setFixtureState('disabled'));await flush();assert.match(await page.$eval('.ai-cost-notice',node=>node.textContent),/unavailable/);
  assert.deepEqual(errors,[]);console.log('Profile cost report: desktop, 360px light/dark, chart navigation, 7/30 days, empty/loading/disabled states passed.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
