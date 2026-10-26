import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const base = { text: 'Make your next idea', frame: 8, fps: 30, durationInFrames: 120, color: '#ffffff', fontSize: 54, highlightColor: '#f5cf45' };
const render = props => page.evaluate(props => window.__revlineRemotionText.render(document.getElementById('text'), props), props);
try {
  await page.setViewport({ width: 800, height: 320 });
  await page.setContent('<style>body{margin:0;background:#141414;color:white;font-family:Arial,sans-serif}#text{display:inline-block;position:absolute;top:110px;left:40px;font-weight:bold;max-width:720px}</style><div id="text"></div>');
  await page.addScriptTag({ content: await readFile('public/vendor/remotion-text.js', 'utf8') });
  assert.equal(await page.evaluate(() => window.__revlineRemotionText.version), '4.0.535');
  for (const preset of ['word-reveal', 'word-pop', 'slide-title', 'karaoke']) {
    const props = { ...base, preset };
    await render(props);
    assert.equal(await page.$eval('#text', el => el.textContent), base.text);
    assert.equal(await page.$eval('[data-remotion-text]', el => el.dataset.frame), '8', 'Render settles synchronously at the requested frame');
    const initial = await page.screenshot();
    await render({ ...props, frame: 100 }); await render({ ...props, frame: 0 }); await render(props);
    assert.deepEqual(await page.screenshot(), initial, `${preset} produces identical pixels after backward seeking`);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 80)));
    assert.deepEqual(await page.screenshot(), initial, `${preset} has no independent animation clock`);
    await render({ ...props, frame: 119 });
    await page.screenshot({ path: `/tmp/revline-remotion-${preset}.png` });
  }
  await render({ ...base, preset: 'word-reveal', frame: 119, text: '<img src=x onerror="window.injection=true">', color: '#ff0000', fontSize: 40 });
  assert.equal(await page.$('#text img'), null);
  assert.equal(await page.evaluate(() => window.injection), undefined);
  assert.equal(await page.$eval('[data-remotion-text]', el => getComputedStyle(el).fontSize), '40px');
  assert.equal(await page.$eval('[data-remotion-text]', el => getComputedStyle(el).color), 'rgb(255, 0, 0)');
  await page.evaluate(() => window.__revlineRemotionText.dispose(document.getElementById('text')));
  assert.equal(await page.$eval('#text', el => el.childElementCount), 0);
  console.log('PASS: all four genuine Remotion templates render synchronously, seek deterministically, stay paused without a clock, preserve editable text/color/size, and safely dispose.');
} finally { await browser.close(); }
