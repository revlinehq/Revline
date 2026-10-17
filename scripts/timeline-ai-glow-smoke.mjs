import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const css = (await Promise.all(['components/editor/custom-timeline.css', 'components/editor/scripted-demo-editor.css'].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')))).join('\n');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 460 });
  for (const preference of ['reduce', 'no-preference']) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: preference }]);
    await page.setContent(`<style>${css}</style><style>:root{--revline-accent:#6552d9;--revline-accent-light:#a692fa}body{margin:0;background:#111}.scripted-editor-demo{height:auto;padding:40px}.custom-timeline{flex:none;width:1000px;height:360px;background:#171719}.fixture-track{height:60px;border-bottom:1px solid #ffffff0c}.fixture-clip{position:absolute;left:180px;top:90px;width:300px;height:48px;background:#433341;color:#c8b4c6;padding:8px;font:12px Arial}</style><main class="scripted-editor-demo" data-building><div class="custom-timeline" data-editing-locked="true"><div class="fixture-track"></div><div class="fixture-track"></div><div class="fixture-track"></div><div class="fixture-clip">Footage · unchanged while AI edits</div><div class="timeline-ai-frame"></div></div></main>`);
    const result = await page.$eval('.timeline-ai-frame', async node => {
      const geometry = () => { const box = node.getBoundingClientRect(); return [box.x, box.y, box.width, box.height]; };
      const initial = getComputedStyle(node, '::before'), duration = parseFloat(initial.animationDuration) * 1000;
      const before = geometry(), samples = [], positions = [];
      const state = { name: initial.animationName, duration, playState: initial.animationPlayState, content: initial.content };
      for (let i = 0; i <= 20; i++) {
        samples.push(Number(getComputedStyle(node, '::before').opacity));
        positions.push(geometry());
        if (i < 20) await new Promise(resolve => setTimeout(resolve, duration / 20));
      }
      return { ...state, samples, before, after: geometry(), geometryStable: positions.every(box => box.every((value, index) => value === before[index])), minimum: Math.min(...samples), maximum: Math.max(...samples) };
    });
    console.log(`${preference}: ${JSON.stringify(result)}`);
    assert.ok(Number.isFinite(result.duration) && result.duration > 0, 'The glow has a real timed animation');
    assert.equal(result.playState, 'running');
    assert.notEqual(result.content, 'none');
    assert.deepEqual(result.after, result.before, 'Breathing never moves or resizes the frame');
    assert.ok(result.geometryStable, 'The frame stays fixed throughout the full animation cycle');
    assert.ok(result.maximum - result.minimum >= .6, `${preference}: visible breathing needs opacity range ≥0.6; measured ${(result.maximum - result.minimum).toFixed(3)}`);
    if (process.argv.includes('--screenshots')) {
      await page.$eval('.timeline-ai-frame', node => { const animation = node.getAnimations({ subtree: true }).find(item => item.animationName?.startsWith('demo-ai-inner-glow')); animation.pause(); animation.currentTime = 0; });
      await (await page.$('.custom-timeline')).screenshot({ path: `/tmp/revline-glow-${preference}-low.png` });
      await page.$eval('.timeline-ai-frame', node => { const animation = node.getAnimations({ subtree: true }).find(item => item.animationName?.startsWith('demo-ai-inner-glow')); animation.currentTime = animation.effect.getTiming().duration / 2; });
      await (await page.$('.custom-timeline')).screenshot({ path: `/tmp/revline-glow-${preference}-high.png` });
    }
  }
  console.log('PASS: actual halo opacity visibly breathes across normal/reduced-motion cycles without moving the timeline frame.');
} finally { await browser.close(); }
