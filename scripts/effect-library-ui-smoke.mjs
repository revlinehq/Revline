import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// Isolated UI fixture: no application server, authenticated project, or provider calls.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {PreviewInspector} from './components/editor/preview-inspector';
import {addEffectClip,patchClip} from './lib/editor/operations';
import {addTextTemplateClip} from './lib/editor/library-actions';

import './components/workspace/workspace-pages.css'; import './app/editor.css';
const assets=[{_id:'photo',fileName:'Light leak.jpg',kind:'image',url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#558879"/></svg>'),duration:5}];
const initial={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:1,effects:0},clips:[
{id:'v1',kind:'image',assetId:'photo',start:0,sourceStart:0,duration:3,track:1,glitch:{enabled:true,intensity:.25,blockSize:32,rgbSplit:8}},
{id:'v2',kind:'image',assetId:'photo',start:3,sourceStart:0,duration:3,track:1,glitch:{enabled:false,intensity:.25,blockSize:32,rgbSplit:8},zoomBlur:{enabled:true,amount:.15,centerX:.5,centerY:.5}},
{id:'words',kind:'graphic',text:'Keep going',start:0,sourceStart:0,duration:3,track:2},
{id:'sound',kind:'audio',start:0,sourceStart:0,duration:6,track:1,volume:.8}]};
function Fixture(){const [timeline,setTimeline]=useState(initial); const [selected,setSelected]=useState('v1');const clip=timeline.clips.find(item=>item.id===selected);window.fixture={timeline,select:setSelected};
const add=(next,id)=>{setTimeline(next);setSelected(id)};
return <PreviewInspector clip={clip} assets={assets} upload={null} onUpload={()=>window.uploads++} onAdd={()=>window.sourceAdds++} onCrop={()=>{}} onChange={patch=>{window.commits++;setTimeline(previous=>patchClip(previous,selected,patch))}} onPlaybackRateChange={()=>{}} onAddEffect={preset=>{const id='fx-'+(++window.nextId);add(addEffectClip(timeline,id,preset,1),id)}} onAddTextTemplate={preset=>{const id='text-'+(++window.nextId);add(addTextTemplateClip(timeline,id,preset,1),id)}}/>}
window.commits=0;window.nextId=0;window.uploads=0;window.sourceAdds=0;createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-library-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page = await browser.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const library=async()=>{await page.click('#inspector-tools-tab');if(!await page.$('.effect-library'))await page.click('#inspector-sources-tab');await flush()};
const choose=async id=>{await page.evaluate(id=>window.fixture.select(id),id);await flush()};
const button=name=>page.locator('::-p-aria([name="'+name+'"][role="button"])');
try{
 await page.setViewport({width:380,height:660});await page.setContent('<html data-workspace-theme="dark"><body><div id="root" class="conversation-editor"></div></body></html>');
 await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
 await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font-family:Arial,sans-serif}#root{width:320px;height:620px;margin:20px auto}button{font-family:inherit}'});
 await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
 await page.waitForSelector('.effect-library');
 const categories=await page.$$eval('.library-category-rail [role="tab"]',nodes=>nodes.map(node=>node.dataset.category));const reached=new Set();for(const category of categories){await page.click('[data-category="'+category+'"]');for(const name of await page.$$eval('.library-look',nodes=>nodes.map(node=>node.getAttribute('aria-label'))))reached.add(name)}for(const name of ['Solid color','Dither','Digital glitch','Color & light','Invert colors','Zoom blur','Cinema bars','Zoom in','Zoom out','Flash','Punch zoom','Impact shake','Pop in','Fade in / out','Change speed'])assert.ok(reached.has(name),'The catalog remains reachable: '+name);await page.click('[data-category="motion"]');assert.equal(await page.$('.library-more'),null);assert.equal(await page.$('[data-segment="overlays"]'),null);assert.equal(await page.$('[aria-label="Fade through black"]'),null);assert.deepEqual(await page.$$eval('.inspector-section-tabs [role="tab"]',nodes=>nodes.map(node=>node.textContent)),['Tools','My media']);
 assert.equal(await page.$('.library-use-count'),null,'Effect previews have no usage badges');
 assert.equal(await page.$$eval('.library-look',tiles=>tiles.some(tile=>/On \d+ clips?/.test(tile.textContent+' '+tile.getAttribute('aria-label')))),false,'No usage count remains in visible or accessible names');
 assert.equal(await page.$$eval('button',buttons=>buttons.some(button=>button.textContent==='Dissolve')),false,'Unsupported dissolve has no pretend action');
 assert.ok(await page.$eval('.preview-inspector',el=>el.scrollWidth<=el.clientWidth),'Library fits the unchanged 320px side panel');
 assert.equal(await page.$('.library-look-preview'),null,'Large effect previews are removed');
 assert.ok(await page.$eval('.library-look',el=>el.getBoundingClientRect().height<=34),'Named effect rows stay compact');
 await page.screenshot({path:'/tmp/revline-effect-library-dark.png'});
 await page.click('[data-category="texture"]');await button('Digital glitch').click();await flush();
 assert.equal(await page.evaluate(()=>window.commits),1,'One apply action commits once');assert.ok(await page.$('[data-effect="glitch"]'));
 await library();await page.type('[aria-label="Search effects"]','blur');
 assert.equal(await page.$$eval('.library-look',tiles=>tiles.length),1,'Search filters previews');
 await button('Zoom blur').click();await button('Clip settings').click();await flush();assert.ok(await page.$('[data-effect="zoomBlur"]'));
 await library();assert.equal(await page.$('.library-use-count'),null,'Applying a look does not add a count badge');assert.ok(await page.$('[aria-label="Zoom blur"]'),'Effect names remain unchanged');
 await button('Cinema bars').click();await button('Clip settings').click();await flush();assert.ok(await page.$('[aria-label="Cinematic bars settings"]'),'Bar tile opens existing size/speed controls');
 assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.at(-1).effectPreset),'cinematic-bars');
 await library();await button('Zoom out').click();await flush();assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.at(-1).effectPreset),'quick-zoom-out');
 await choose('v1');await library();
 await choose('v1');await library();await page.click('[data-segment="text"]');await button('Pop-in words').click();await flush();
 assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.at(-1).textTemplate.preset),'word-pop','Text tile creates a supported template');
 await page.waitForSelector('[aria-label="Text templates"]');assert.ok(await page.$('[aria-label="Text templates"]'),'Text editing controls are available after adding');
 assert.ok(await page.$('[aria-label="Selected text"]'),'New text is immediately editable after choosing a template');
 assert.ok(await page.$('[aria-label="Custom text size"]'),'Text size remains available beside the words');
 await library();await page.click('#inspector-media-tab');assert.ok(await page.$('.footage-content-inspector'),'My media opens the reusable source list');assert.equal(await page.$('.effect-library'),null,'Only one pane is visible');await button('Add files').click();assert.equal(await page.evaluate(()=>window.uploads),1);await page.click('[data-asset-id="photo"]');assert.equal(await page.evaluate(()=>window.sourceAdds),1);assert.equal(await page.$('.library-media-access'),null,'There is no second media navigation route');
 await library();await choose('sound');await page.click('[data-category="texture"]');assert.equal(await page.$eval('[aria-label="Digital glitch"]',el=>el.getAttribute('aria-disabled')),'true','Audio cannot receive visual effects');const commits=await page.evaluate(()=>window.commits);await button('Digital glitch').click();assert.equal(await page.evaluate(()=>window.commits),commits);assert.equal(await page.evaluate(()=>document.body.textContent.includes('Drag an effect onto footage or the timeline. The + adds timed looks at the playhead.')),false,'The requested helper is removed');
 await page.focus('[data-segment="effects"]');await page.keyboard.press('End');assert.equal(await page.$eval('[data-segment="text"]',el=>document.activeElement===el&&el.getAttribute('aria-selected')==='true'),true,'Library segments support keyboard navigation');await page.keyboard.press('Home');await choose('v1');
 await page.evaluate(()=>{document.activeElement?.blur();document.documentElement.dataset.workspaceTheme='light'});assert.ok(await page.$eval('.preview-inspector',el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:'/tmp/revline-effect-library-light.png'});
 await page.setViewport({width:320,height:660});await page.addStyleTag({content:'#root{width:320px;margin:0;height:660px}'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Library does not overflow a narrow viewport');
 assert.deepEqual(errors,[]);
 console.log('PASS: approved category-rail Tools library geometry, no usage badges, search, real visual/timed/text actions, one apply save, direct My media import/add, audio guards, shared keyboard segments, light/dark, and narrow viewport. Isolated fixture only; no project mutations.');
}finally{await browser.close()}
