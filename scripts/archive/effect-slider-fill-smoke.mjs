import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {CinematicBarsControls,VisualEffectsControls} from './components/editor/visual-effects-controls';
import {EffectSlider} from './components/editor/effect-slider';
import {VISUAL_EFFECT_LIMITS} from './lib/editor/visual-effects';
import './components/workspace/workspace-pages.css';import './app/editor.css';import './components/editor/footage-panel.css';
const effects=Object.fromEntries(Object.entries(VISUAL_EFFECT_LIMITS).map(([key,limits])=>[key,{enabled:true,...Object.fromEntries(Object.entries(limits).map(([parameter,[min,max]])=>[parameter,Number.isInteger(min)&&Number.isInteger(max)&&max-min>2?Math.round((min+max)/2):(min+max)/2]))}]));
function Fixture(){
 const[bars,setBars]=useState({id:'bars',kind:'effect',effectPreset:'cinematic-bars',start:0,sourceStart:0,duration:4});
 const[clip,setClip]=useState({id:'video',kind:'video',start:0,sourceStart:0,duration:4,...effects});
 const[textSize,setTextSize]=useState(52),[shadowBlur,setShadowBlur]=useState(8);window.setShadowBlur=setShadowBlur;
 window.bars=bars;window.setBars=setBars;window.clip=clip;window.textSize=textSize;
 const commit=patch=>{window.commits.push(patch);setBars(previous=>({...previous,...patch}))};
 return <><CinematicBarsControls clip={bars} onChange={commit} onPreview={patch=>window.previews.push(patch)}/><VisualEffectsControls clip={clip} onChange={patch=>setClip(previous=>({...previous,...patch}))}/><div className="visual-effects-controls"><EffectSlider label="Text size" value={textSize} bounds={[8,300]} step={1} format={value=>value+' px'} disabled={false} onPreview={()=>{}} onCommit={setTextSize}/><EffectSlider label="Shadow blur" value={shadowBlur} bounds={[0,80]} step={1} format={value=>value+' px'} disabled={false} onPreview={()=>{}} onCommit={setShadowBlur}/></div></>;
}
window.commits=[];window.previews=[];window.resetCounters=()=>{window.commits=[];window.previews=[]};createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-slider-fill-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const input = label => `input[aria-label="${label}"]`;
const counters = () => page.evaluate(() => ({ commits: window.commits.length, previews: window.previews.length }));
async function verifyHandles() {
  const handles = await page.$$eval('.effect-slider', sliders => sliders.map(slider => {
    const handle = slider.querySelector('.effect-slider-handle'), bounds = slider.getBoundingClientRect(), rect = handle?.getBoundingClientRect(), style = handle && getComputedStyle(handle);
    const fillWidth = slider.querySelector('.effect-slider-fill')?.getBoundingClientRect().width ?? 0;
    return { count: slider.querySelectorAll('.effect-slider-handle').length, width: rect?.width, height: rect?.height, left: rect ? rect.left - bounds.left : -1, right: rect ? bounds.right - rect.right : -1, expectedLeft: Math.min(bounds.width - 2, Math.max(0, fillWidth - 7)), sliderHeight:bounds.height,inputHeight:slider.querySelector('input').getBoundingClientRect().height,readoutBottom:Math.max(...[...slider.querySelector('.effect-slider-readout').children].map(node=>node.getBoundingClientRect().bottom)),markerTop:rect?.top, radius: style?.borderRadius, color: style?.backgroundColor, pointerEvents: style?.pointerEvents, hiddenFromAccessibility: handle?.getAttribute('aria-hidden') };
  }));
  assert.ok(handles.length>=24,'All current shared controls and the reported Shadow blur case are covered');
  for (const handle of handles) {
    assert.equal(handle.count, 1, 'Each slider retains one full vertical handle');
    assert.equal(handle.width,2);assert.equal(handle.height,16);assert.equal(handle.sliderHeight,28);assert.equal(handle.inputHeight,28,'Full-height drag target is preserved'); assert.equal(handle.radius, '1px');
    assert.equal(handle.color, 'rgb(255, 255, 255)'); assert.equal(handle.pointerEvents, 'none');
    assert.equal(handle.hiddenFromAccessibility, 'true');
    assert.ok(handle.left >= -.01 && handle.right >= -.01, 'Position markers stay inside their sliders at every value');
    assert.ok(Math.abs(handle.left - handle.expectedLeft) < .05, 'The original vertical handle tracks the measured fill boundary');
  }
}
async function verifyFills(theme) {
  await page.evaluate(theme => { document.documentElement.dataset.workspaceTheme = theme; }, theme);
  const fills = await page.$$eval('.effect-slider', sliders => sliders.map(slider => {
    const input = slider.querySelector('input'), fill = slider.querySelector('.effect-slider-fill');
    const expected = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
    const style = fill && getComputedStyle(fill);
    const channels = style?.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    return { label: input.getAttribute('aria-label'), expected, sliderWidth: slider.getBoundingClientRect().width, fillWidth: fill?.getBoundingClientRect().width ?? 0, color: style?.backgroundColor ?? 'missing', blue: channels[2] > channels[0] && channels[2] > channels[1], pointerEvents: style?.pointerEvents, inputBackground:getComputedStyle(input).backgroundColor };
  }));
  assert.ok(fills.length>=24,'All current shared effect controls and text controls are covered');
  for (const fill of fills) {
    assert.equal(fill.inputBackground,'rgba(0, 0, 0, 0)',`${theme} ${fill.label} input must not cover its label/value/fill`);
    assert.ok(fill.fillWidth > 0, `${theme} ${fill.label} has a rendered progress fill`);
    assert.ok(Math.abs(fill.fillWidth / fill.sliderWidth - fill.expected) < .005, `${theme} ${fill.label} reflects its actual range value`);
    assert.notEqual(fill.color, 'rgba(0, 0, 0, 0)', `${theme} ${fill.label} fill is visible`);
    assert.equal(fill.color,'rgb(98, 84, 213)', `${theme} ${fill.label} matches the approved violet accent`);
    assert.equal(fill.pointerEvents, 'none', `${theme} ${fill.label} fill cannot intercept gestures`);
  }
  assert.equal(new Set(fills.map(fill => fill.color)).size, 1, `${theme} uses the same blue for every effect slider`);
  await verifyHandles();
  return fills;
}
try {
  await page.setViewport({ width: 420, height: 1000 });
  await page.setContent('<html data-workspace-theme="dark"><body><div class="preview-inspector-sheet"><div id="root" class="conversation-editor preview-inspector"></div></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font:12px Arial}#root{width:340px;min-height:100vh;padding:16px;margin:0 auto;display:block}.visual-effects-controls{margin-bottom:18px}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.waitForSelector(input('Size'));
  await page.$$eval('.frame-distortion-advanced',nodes=>nodes.forEach(node=>node.open=true));
  await verifyFills('light'); await verifyFills('dark');
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.workspaceTheme=theme,theme);for(const value of [0,8,40,72,80]){await page.evaluate(value=>window.setShadowBlur(value),value);await flush();await verifyHandles();const row=await page.$('.effect-slider:has(input[aria-label="Shadow blur"])'),label=await row.$('.effect-slider-readout>span'),output=await row.$('.effect-slider-readout output'),before=[await label.screenshot(),await output.screenshot()];await row.$eval('.effect-slider-handle',node=>node.style.visibility='hidden');const after=[await label.screenshot(),await output.screenshot()];assert.deepEqual(after,before,`${theme} value${value}: full handle must not alter label or value pixels`);await row.$eval('.effect-slider-handle',node=>node.style.visibility='');}await page.evaluate(()=>window.setShadowBlur(8));await flush();const reportedRow=await page.$('.effect-slider:has(input[aria-label="Shadow blur"])');await reportedRow.screenshot({path:`/tmp/revline-slider-marker-${theme}.png`});}
  await page.evaluate(()=>window.setShadowBlur(8));await flush();
  await page.screenshot({ path: '/tmp/revline-effect-slider-fill-dark.png', clip: { x: 40, y: 0, width: 340, height: 930 } });
  await page.evaluate(() => window.resetCounters()); await page.focus(input('Size'));
  const before = await page.$eval(input('Size'), input => Number(input.value));
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await flush();
  assert.equal((await counters()).commits, 0, 'Keyboard preview does not save before keyup');
  assert.ok((await counters()).previews > 0);
  await page.keyboard.up('ArrowRight'); await flush();
  assert.equal((await counters()).commits, 1, 'Keyboard commits once');
  assert.ok(await page.$eval(input('Size'), input => Number(input.value)) > before);
  await verifyFills('dark');
  await page.evaluate(() => window.resetCounters());
  const bounds = await page.$eval(input('Speed'), input => { const rect = input.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .75, bounds.y + bounds.height / 2, { steps: 6 }); await flush();
  assert.equal((await counters()).commits, 0, 'Pointer preview does not save before release');
  assert.ok((await counters()).previews > 0);
  await page.mouse.up(); await flush(); assert.equal((await counters()).commits, 1, 'Pointer commits once');
  await verifyFills('dark');
  await page.evaluate(() => window.resetCounters()); await page.focus(input('Speed'));
  const saved = await page.$eval(input('Speed'), input => Number(input.value));
  await page.keyboard.down('ArrowLeft'); await flush(); await page.keyboard.press('Escape'); await page.keyboard.up('ArrowLeft'); await flush();
  assert.equal((await counters()).commits, 0, 'Escape cancels the gesture');
  assert.equal(await page.$eval(input('Speed'), input => Number(input.value)), saved);
  assert.equal(await page.evaluate(() => window.previews.at(-1)), null);
  await page.click('[aria-label="Enable Color"]'); await flush();
  assert.equal(await page.$eval(input('Exposure'), input => input.disabled), true);
  await verifyFills('dark');
  await page.focus(input('Text size')); await page.keyboard.press('End'); await flush();
  assert.equal(await page.$eval('[aria-label="Text size"]', input => input.value), '300');
  await verifyFills('dark');
  await page.focus(input('Size')); await page.keyboard.press('Home'); await flush();
  assert.equal(await page.$eval('[aria-label="Size"]', input => input.value), '0');
  assert.equal(await page.$eval('[aria-label="Size"]', input => input.parentElement.querySelector('.effect-slider-fill').getBoundingClientRect().width), 0, 'The range minimum has zero fill');
  await verifyHandles();
  await page.screenshot({ path: '/tmp/revline-effect-slider-pill-dark.png', clip: { x: 40, y: 0, width: 340, height: 930 } });
  assert.deepEqual(errors, []);
  console.log('PASS: shared sliders show violet fill and the original full vertical handle; labels/values use matching fill backplates over the handle at min, low, middle and max in light/dark with full 28px input hit areas; cinematic bars keyboard/pointer previews, single commit, cancel; disabled values retained; standalone text size. Synthetic only.');
} finally { await browser.close(); }
