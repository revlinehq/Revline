import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// Isolated UI fixture: no application server, authenticated project, or provider calls.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {PreviewInspector} from './components/editor/preview-inspector';
import {addEffectClip,patchClip} from './lib/editor/operations';
import {addFadeThroughBlack,addOverlayClip,addTextTemplateClip} from './lib/editor/library-actions';
import {PORTRAIT_URL,COFFEE_URL} from './lib/editor/demo';
import './components/workspace/workspace-pages.css'; import './app/editor.css';
const assets=[{_id:'photo',fileName:'Light leak.jpg',kind:'image',url:COFFEE_URL,duration:5}];
const initial={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:1,effects:0},clips:[
{id:'v1',kind:'image',assetId:'photo',start:0,sourceStart:0,duration:3,track:1,glitch:{enabled:true,intensity:.25,blockSize:32,rgbSplit:8}},
{id:'v2',kind:'image',assetId:'photo',start:3,sourceStart:0,duration:3,track:1,glitch:{enabled:false,intensity:.25,blockSize:32,rgbSplit:8},zoomBlur:{enabled:true,amount:.15,centerX:.5,centerY:.5}},
{id:'words',kind:'graphic',text:'Keep going',start:0,sourceStart:0,duration:3,track:2},
{id:'sound',kind:'audio',start:0,sourceStart:0,duration:6,track:1,volume:.8}]};
function Fixture(){const [timeline,setTimeline]=useState(initial); const [selected,setSelected]=useState('v1');const clip=timeline.clips.find(item=>item.id===selected);window.fixture={timeline,select:setSelected};
const add=(next,id)=>{setTimeline(next);setSelected(id)};
return <PreviewInspector clip={clip} assets={assets} upload={null} onUpload={()=>window.uploads++} onAdd={()=>window.sourceAdds++} onCrop={()=>{}} onClose={()=>{}} onChange={patch=>{window.commits++;setTimeline(previous=>patchClip(previous,selected,patch))}} onPlaybackRateChange={()=>{}} onAddEffect={preset=>{const id='fx-'+(++window.nextId);add(addEffectClip(timeline,id,preset,1),id)}} onAddTextTemplate={preset=>{const id='text-'+(++window.nextId);add(addTextTemplateClip(timeline,id,preset,1),id)}} onAddOverlay={asset=>{const id='overlay-'+(++window.nextId);add(addOverlayClip(timeline,asset,id,1),id)}} onFadeThroughBlack={()=>{const id='transition-'+(++window.nextId);add(addFadeThroughBlack(timeline,selected,id),id)}}/>}
window.commits=0;window.nextId=0;window.uploads=0;window.sourceAdds=0;createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-library-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page = await browser.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const library=async()=>{if(!await page.$('.effect-library'))await page.click('#inspector-sources-tab');await flush()};
const choose=async id=>{await page.evaluate(id=>window.fixture.select(id),id);await flush()};
const button=name=>page.locator('::-p-aria([name="'+name+'"][role="button"])');
try{
 await page.setViewport({width:380,height:660});await page.setContent('<html data-workspace-theme="dark"><body><div id="root" class="conversation-editor"></div></body></html>');
 await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
 await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font-family:Arial,sans-serif}#root{width:320px;height:620px;margin:20px auto}button{font-family:inherit}'});
 await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
 await page.waitForSelector('.effect-library');
 assert.equal(await page.$$eval('.library-look-grid:first-child .library-look',elements=>elements.length),4);
 assert.equal(await page.$('.library-use-count'),null,'Effect previews have no usage badges');
 assert.equal(await page.$$eval('.library-look',tiles=>tiles.some(tile=>/On \d+ clips?/.test(tile.textContent+' '+tile.getAttribute('aria-label')))),false,'No usage count remains in visible or accessible names');
 assert.equal(await page.$$eval('button',buttons=>buttons.some(button=>button.textContent==='Dissolve')),false,'Unsupported dissolve has no pretend action');
 assert.ok(await page.$eval('.preview-inspector',el=>el.scrollWidth<=el.clientWidth),'Library fits the unchanged 320px side panel');
 assert.equal(await page.$('.library-look-preview'),null,'Large effect previews are removed');
 assert.ok(await page.$eval('.library-look',el=>el.getBoundingClientRect().height<=34),'Named effect rows stay compact');
 await page.screenshot({path:'/tmp/revline-effect-library-dark.png'});
 await button('Digital glitch').click();await flush();
 assert.equal(await page.evaluate(()=>window.commits),1,'One apply action commits once');assert.ok(await page.$('[data-effect="glitch"]'));
 await library();await page.type('[aria-label="Search effect library"]','blur');
 assert.equal(await page.$$eval('.library-look',tiles=>tiles.length),1,'Search filters previews');
 await button('Zoom blur').click();await flush();assert.ok(await page.$('[data-effect="zoomBlur"]'));
 await library();assert.equal(await page.$('.library-use-count'),null,'Applying a look does not add a count badge');assert.ok(await page.$('[aria-label="Zoom blur"]'),'Effect names remain unchanged');
 await button('Cinema bars').click();await flush();assert.ok(await page.$('[aria-label="Cinematic bars settings"]'),'Bar tile opens existing size/speed controls');
 assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.at(-1).effectPreset),'cinematic-bars');
 await library();await page.click('.library-more');await button('Zoom out').click();await flush();assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.at(-1).effectPreset),'quick-zoom-out');
 await choose('v1');await library();
 const before=await page.evaluate(()=>window.fixture.timeline.clips.filter(clip=>clip.kind!=='effect'));
 await button('Fade through black').click();await flush();
 const after=await page.evaluate(()=>window.fixture.timeline);
 assert.deepEqual(after.clips.filter(clip=>clip.kind!=='effect'),before,'Transition preserves source timing, text, and audio');
 const transition=after.clips.at(-1);assert.equal(transition.start+transition.motion[1].time,3,'Black peak sits exactly on the cut');assert.deepEqual(transition.motion.map(key=>key.opacity),[1,0,1]);
 await choose('v1');await library();await page.click('[data-library-tab="text"]');await button('Pop-in words').click();await flush();
 assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.at(-1).textTemplate.preset),'word-pop','Text tile creates a supported template');
 assert.ok(await page.$('[aria-label="Text templates"]'),'Text editing controls are available after adding');
 assert.ok(await page.$('[aria-label="Selected text"]'),'New text is immediately editable after choosing a template');
 assert.ok(await page.$('[aria-label="Text rotation"]'),'Text rotation is available beside the words');
 await choose('v1');await library();await page.click('[data-library-tab="overlays"]');await button('Upload an overlay').click();assert.equal(await page.evaluate(()=>window.uploads),1);
 await button('Light leak.jpg').click();await flush();const overlay=await page.evaluate(()=>window.fixture.timeline.clips.at(-1));assert.equal(overlay.start,1);assert.ok(overlay.track>2,'Overlay is above footage and existing text at the playhead');
 await button('Edit selected clip').click();await page.select('[aria-label="Blend mode"]','screen');await flush();assert.equal(await page.evaluate(()=>window.fixture.timeline.clips.at(-1).blendMode),'screen','An overlay exposes the real supported Screen blend');
 await library();await button('Your media').click();assert.ok(await page.$('.footage-content-inspector'),'Your media opens existing sources');
 await library();await choose('sound');assert.equal(await page.$eval('[aria-label^="Digital glitch"]',el=>el.disabled),true,'Audio cannot receive visual effects');
 await page.focus('[data-library-tab="effects"]');await page.keyboard.press('End');assert.equal(await page.$eval('[data-library-tab="overlays"]',el=>document.activeElement===el&&el.getAttribute('aria-selected')==='true'),true,'Library tabs support keyboard navigation');
 await page.keyboard.press('Home');await choose('v1');
 await page.evaluate(()=>{document.activeElement?.blur();document.documentElement.dataset.workspaceTheme='light'});assert.ok(await page.$eval('.preview-inspector',el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:'/tmp/revline-effect-library-light.png'});
 await page.setViewport({width:320,height:660});await page.addStyleTag({content:'#root{width:320px;margin:0;height:660px}'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Library does not overflow a narrow viewport');
 assert.deepEqual(errors,[]);
 console.log('PASS: RyGlj library geometry, no usage badges, search, real visual/timed/text/overlay/transition actions, one apply save, existing source access, audio guards, keyboard tabs, light/dark, and narrow viewport. Isolated fixture only; no project mutations.');
}finally{await browser.close()}
