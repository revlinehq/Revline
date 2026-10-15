import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';

const require=createRequire(import.meta.url);
const harness=`import React,{useEffect}from'react';import{EffectLibrary}from'./components/editor/effect-library';
function Harness(){useEffect(()=>{window.hydrated=true},[]);return <EffectLibrary assets={[]} onVisualEffect={()=>{}} onAddEffect={()=>{}} onAddTransition={()=>{}} onTextLook={()=>{}}/>}`;
const fixtures=new Map();
for(const mode of ['development','production']){
  const common={bundle:true,write:false,loader:{'.css':'empty'},define:{'process.env.NODE_ENV':JSON.stringify(mode)},logLevel:'silent'};
  const [server,client]=await Promise.all([
    build({...common,stdin:{resolveDir:process.cwd(),loader:'tsx',contents:harness+`;import{renderToString}from'react-dom/server';export const html=renderToString(<Harness/>);`},platform:'node',format:'cjs'}),
    build({...common,stdin:{resolveDir:process.cwd(),loader:'tsx',contents:harness+`;import{hydrateRoot}from'react-dom/client';window.hydrationErrors=[];hydrateRoot(document.getElementById('root'),<Harness/>,{onRecoverableError:error=>window.hydrationErrors.push(error.message)});`},platform:'browser',format:'iife'})
  ]);
  const module={exports:{}};new Function('require','module','exports',server.outputFiles[0].text)(require,module,module.exports);
  fixtures.set(mode,{html:module.exports.html,client:client.outputFiles[0].text});
}
let mode='development',corrupt=false;
const server=createServer((request,response)=>{
  const fixture=fixtures.get(mode);
  if(request.url==='/client.js'){response.setHeader('Content-Type','text/javascript');response.end(fixture.client);return;}
  const html=corrupt?fixture.html.replace(/<button\b[^>]*data-category="remotion-dev"[^>]*>[\s\S]*?<\/button>/,''):fixture.html;
  response.setHeader('Content-Type','text/html');response.end(`<div id="root">${html}</div><script src="/client.js"></script>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  const origin=`http://127.0.0.1:${server.address().port}`;
  const categories=html=>[...html.matchAll(/data-category="([^"]+)"/g)].map(match=>match[1]);
  for(const current of ['development','production']){
    mode=current;const expected=categories(fixtures.get(current).html);
    if(current==='development')assert.deepEqual(expected,['motion','color','texture','transitions','text','sam-dev','remotion-dev','sfx-dev']);
    else assert.deepEqual(expected,['motion','color','texture','transitions','text']);
    await page.goto(origin);await page.waitForFunction(()=>window.hydrated===true);
    assert.deepEqual(await page.$$eval('[data-category]',nodes=>nodes.map(node=>node.dataset.category)),expected);
    assert.deepEqual(await page.evaluate(()=>window.hydrationErrors),[],`${current} category rail hydrates identically`);
  }
  // Reproduce the reported missing-server-tab mismatch as a negative control.
  mode='development';corrupt=true;await page.goto(origin);await page.waitForFunction(()=>window.hydrated===true);
  assert.ok((await page.evaluate(()=>window.hydrationErrors)).some(message=>/hydrat|didn.t match/i.test(message)),'The regression detects a stale server category rail missing Remotion');
  corrupt=false;await page.reload();await page.waitForFunction(()=>window.hydrated===true);assert.deepEqual(await page.evaluate(()=>window.hydrationErrors),[],'Fresh server markup recovers without suppressing hydration');
  console.log('PASS: actual EffectLibrary SSR hydrates with identical category order in development and production. Missing-server Remotion tab negative control reproduces the hydration mismatch; fresh markup recovers without hydration suppression or client-only rendering.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
