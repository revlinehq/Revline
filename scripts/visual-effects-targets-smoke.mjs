import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';

// Isolated real WebGL kernel: no project, network, AI, worker or account state.
const buildRuntime = contents => build({ ...(contents ? { stdin: { contents, loader: 'ts', resolveDir: new URL('../lib/editor', import.meta.url).pathname } } : { entryPoints: ['lib/editor/visual-effects-runtime.ts'] }), bundle: true, write: false, platform: 'browser', format: 'iife', globalName: '__revlineVisualEffects' });
const current = (await buildRuntime()).outputFiles[0].text;
const baselineRef = process.env.BASELINE_REF;
const baseline = baselineRef ? (await buildRuntime(execFileSync('git', ['show', `${baselineRef}:lib/editor/visual-effects-runtime.ts`], { encoding: 'utf8' }))).outputFiles[0].text : null;
const fixture = await build({ stdin: { contents: `import{visualEffectsPatch}from'./lib/editor/visual-effects';window.effects=visualEffectsPatch({kind:'image'}, {colorGrade:{enabled:true,contrast:1.2},softBlur:{enabled:true,amount:8},zoomBlur:{enabled:true,amount:.2},frameCorners:{enabled:true,amount:.25}});`, loader: 'ts', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife' });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
async function setup(runtime) {
  const page = await browser.newPage(); await page.setViewport({ width: 640, height: 360 });
  await page.setContent('<meta name="hyperframes-studio-preview"><div id="composition" data-width="640" data-height="360"><div style="position:relative;width:320px;height:180px"><img id="source" data-start="0" data-duration="2" style="position:absolute;width:320px;height:180px"></div></div>');
  await page.evaluate(async () => {
    const image = document.querySelector('img'); image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><path fill="#2b71a2" d="M0 0H320V180H0Z"/><circle fill="#e8c065" cx="110" cy="80" r="55"/><path fill="#e4597a" d="M160 0H320V180H160Z"/></svg>'); await image.decode();
    window.errors = []; window.statusChecks = 0; window.__timelines = { revline: { time: () => .5, render() {}, eventCallback() {} } };
    const original = WebGLRenderingContext.prototype.checkFramebufferStatus;
    WebGLRenderingContext.prototype.checkFramebufferStatus = function (...args) { window.statusChecks++; return original.apply(this, args); };
    addEventListener('revline-effects-error', event => window.errors.push(event.detail));
  });
  await page.addScriptTag({ content: fixture.outputFiles[0].text }); await page.addScriptTag({ content: runtime });
  await page.evaluate(() => window.__revlineVisualEffects.installVisualEffects([{ id: 'source', ...window.effects }], 30, 1080));
  await page.waitForSelector('.visual-effect-output'); return page;
}
const pixels = page => page.$eval('.visual-effect-output', canvas => canvas.toDataURL());
try {
  const page = await setup(current), original = await pixels(page);
  if (baseline) { const before = await setup(baseline); assert.equal(await pixels(before), original, 'Changing framebuffer validation preserves every rendered pixel'); await before.close(); }
  const checks = await page.evaluate(() => window.statusChecks);
  assert.equal(checks, 2, 'Both intermediate targets are validated at allocation');
  await page.evaluate(() => { for (let i = 0; i < 20; i++) window.__revlineEffects.redraw(); });
  assert.equal(await page.evaluate(() => window.statusChecks), checks, 'Normal redraw never repeats framebuffer validation'); assert.equal(await pixels(page), original);
  await page.evaluate(() => window.__revlineEffects.set('source', { ...window.effects, directionalBlur: { enabled: true, amount: 5, angle: 0 } }));
  assert.equal(await page.evaluate(() => window.statusChecks), checks + 2, 'Resizing pass targets validates both again');
  await page.evaluate(() => window.__revlineEffects.set('source', window.effects)); assert.equal(await pixels(page), original, 'Returning to the original pass count preserves exact pixels');
  await page.evaluate(() => {
    const prototype = WebGLRenderingContext.prototype, original = prototype.checkFramebufferStatus;
    prototype.checkFramebufferStatus = function () { return this.FRAMEBUFFER_UNSUPPORTED; };
    try { window.__revlineEffects.set('source', { ...window.effects, directionalBlur: { enabled: true, amount: 5, angle: 0 } }); } finally { prototype.checkFramebufferStatus = original; }
  });
  assert.equal(await page.$('.visual-effect-output'), null); assert.equal(await page.$eval('#source', node => node.hasAttribute('data-revline-effects')), false, 'Invalid target restores the source');
  assert.match(await page.evaluate(() => window.errors.at(-1)), /intermediate target is unavailable/);
  await page.evaluate(() => window.__revlineEffects.set('source', window.effects)); assert.equal(await pixels(page), original);
  await page.evaluate(() => new Promise(resolve => { const canvas = document.querySelector('.visual-effect-output'), gl = canvas.getContext('webgl'); canvas.addEventListener('webglcontextlost', resolve, { once: true }); gl.getExtension('WEBGL_lose_context').loseContext(); }));
  await page.evaluate(() => window.__revlineEffects.redraw()); assert.equal(await page.$('.visual-effect-output'), null); assert.equal(await page.$eval('#source', node => node.hasAttribute('data-revline-effects')), false, 'Lost context restores the source');
  assert.match(await page.evaluate(() => window.errors.at(-1)), /WebGL context was lost/);
  await page.evaluate(() => window.__revlineEffects.set('source', window.effects)); assert.equal(await pixels(page), original, 'Retry creates a healthy context instead of reusing the lost one');
  await page.evaluate(() => new Promise(resolve => {
    window.pooledCanvas=document.querySelector('.visual-effect-output');const gl=window.pooledCanvas.getContext('webgl');window.__revlineEffects.set('source',{});
    window.pooledCanvas.addEventListener('webglcontextlost',resolve,{once:true});gl.getExtension('WEBGL_lose_context').loseContext();
  }));
  await page.evaluate(() => window.__revlineEffects.set('source', window.effects));
  assert.equal(await page.evaluate(() => document.querySelector('.visual-effect-output')===window.pooledCanvas),false,'A context lost while pooled is not reused');
  assert.equal(await pixels(page),original,'Replacing a lost pooled context preserves pixels');
  await page.close(); console.log('PASS: exact pixels across pass resize/redraw and optional baseline comparison, allocation-only validation, invalid-target fallback, lost-context fallback and healthy retry.');
} finally { await browser.close(); }
