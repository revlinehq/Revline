import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {CinematicBarsControls,VisualEffectsControls} from './components/editor/visual-effects-controls';
import {EffectSlider} from './components/editor/effect-slider';
import {VISUAL_EFFECT_LIMITS} from './lib/editor/visual-effects';
import './components/workspace/workspace-pages.css';import './app/editor.css';
const effects=Object.fromEntries(Object.entries(VISUAL_EFFECT_LIMITS).map(([key,limits])=>[key,{enabled:true,...Object.fromEntries(Object.entries(limits).map(([parameter,[min,max]])=>[parameter,Number.isInteger(min)&&Number.isInteger(max)&&max-min>2?Math.round((min+max)/2):(min+max)/2]))}]));
function Fixture(){
 const[bars,setBars]=useState({id:'bars',kind:'effect',effectPreset:'cinematic-bars',start:0,sourceStart:0,duration:4});
 const[clip,setClip]=useState({id:'video',kind:'video',start:0,sourceStart:0,duration:4,...effects});
 const[textSize,setTextSize]=useState(52);
 window.bars=bars;window.setBars=setBars;window.clip=clip;window.textSize=textSize;
 const commit=patch=>{window.commits.push(patch);setBars(previous=>({...previous,...patch}))};
 return <><CinematicBarsControls clip={bars} onChange={commit} onPreview={patch=>window.previews.push(patch)}/><VisualEffectsControls clip={clip} onChange={patch=>setClip(previous=>({...previous,...patch}))}/><div className="visual-effects-controls"><EffectSlider label="Text size" value={textSize} bounds={[8,300]} step={1} format={value=>value+' px'} disabled={false} onPreview={()=>{}} onCommit={setTextSize}/></div></>;
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
    return { count: slider.querySelectorAll('.effect-slider-handle').length, width: rect?.width, height: rect?.height, left: rect ? rect.left - bounds.left : -1, right: rect ? bounds.right - rect.right : -1, expectedLeft: Math.min(bounds.width - 2, Math.max(0, fillWidth - 7)), radius: style?.borderRadius, color: style?.backgroundColor, pointerEvents: style?.pointerEvents, hiddenFromAccessibility: handle?.getAttribute('aria-hidden') };
  }));
  assert.equal(handles.length, 23);
  for (const handle of handles) {
    assert.equal(handle.count, 1, 'Each slider has a single undivided pill');
    assert.equal(handle.width, 2); assert.equal(handle.height, 16); assert.equal(handle.radius, '1px');
    assert.equal(handle.color, 'rgb(255, 255, 255)'); assert.equal(handle.pointerEvents, 'none');
    assert.equal(handle.hiddenFromAccessibility, 'true');
    assert.ok(handle.left >= -.01 && handle.right >= -.01, 'Pills stay inside their sliders at every value');
    assert.ok(Math.abs(handle.left - handle.expectedLeft) < .05, 'The pill tracks the measured fill boundary');
  }
}
async function verifyFills(theme) {
  await page.evaluate(theme => { document.documentElement.dataset.workspaceTheme = theme; }, theme);
  const fills = await page.$$eval('.effect-slider', sliders => sliders.map(slider => {
    const input = slider.querySelector('input'), fill = slider.querySelector('.effect-slider-fill');
    const expected = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
    const style = fill && getComputedStyle(fill);
    const channels = style?.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    return { label: input.getAttribute('aria-label'), expected, sliderWidth: slider.getBoundingClientRect().width, fillWidth: fill?.getBoundingClientRect().width ?? 0, color: style?.backgroundColor ?? 'missing', blue: channels[2] > channels[0] && channels[2] > channels[1], pointerEvents: style?.pointerEvents };
  }));
  assert.equal(fills.length, 23, 'Bars, all visual effect parameters including Neon edges, and standalone text size are covered');
  for (const fill of fills) {
    assert.ok(fill.fillWidth > 0, `${theme} ${fill.label} has a rendered progress fill`);
    assert.ok(Math.abs(fill.fillWidth / fill.sliderWidth - fill.expected) < .005, `${theme} ${fill.label} reflects its actual range value`);
    assert.notEqual(fill.color, 'rgba(0, 0, 0, 0)', `${theme} ${fill.label} fill is visible`);
    assert.equal(fill.color,'rgb(71, 104, 239)', `${theme} ${fill.label} matches the approved Pen blue`);
    assert.equal(fill.pointerEvents, 'none', `${theme} ${fill.label} fill cannot intercept gestures`);
  }
  assert.equal(new Set(fills.map(fill => fill.color)).size, 1, `${theme} uses the same blue for every effect slider`);
  await verifyHandles();
  return fills;
}
try {
  await page.setViewport({ width: 420, height: 1000 });
  await page.setContent('<html data-workspace-theme="dark"><body><div id="root" class="conversation-editor preview-inspector"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font:12px Arial}#root{width:340px;min-height:100vh;padding:16px;margin:0 auto;display:block}.visual-effects-controls{margin-bottom:18px}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.waitForSelector(input('Size'));
  await verifyFills('light'); await verifyFills('dark');
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
  console.log('PASS: 23 shared sliders show the same blue fill at measured range widths and one white rounded pill contained at min/max in light/dark; cinematic bars keyboard/pointer previews, single commit, cancel; disabled values retained; standalone text size. Synthetic only.');
} finally { await browser.close(); }
