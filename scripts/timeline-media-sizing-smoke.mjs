import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const dir = await mkdtemp(join(tmpdir(), 'revline-media-sizing-'));
const browser = await puppeteer.launch({ executablePath: '/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

// waitForFunction stalls after the file chooser in current Chrome headless, so poll with evaluate.
async function until(predicate, arg, label) {
  for (const start = Date.now(); !await page.evaluate(predicate, arg);) { assert.ok(Date.now() - start < 15000, label); await new Promise(resolve => setTimeout(resolve, 100)); }
}

// Filmstrips render one <img> per frame tile (object-fit: contain) instead of a repeated background
// image; each tile's width follows the source ratio at the row height (media-filmstrip.tsx).
async function measure(name) {
  await page.waitForFunction(fileName => [...document.querySelectorAll('.clip-video')].find(node => node.getAttribute('aria-label')?.startsWith(fileName))?.querySelector('.filmstrip-frame img'), {}, name);
  return page.evaluate(async fileName => {
    const clip = [...document.querySelectorAll('.clip-video')].find(node => node.getAttribute('aria-label')?.startsWith(fileName));
    const strip = clip?.querySelector('.filmstrip');
    if (!strip) throw new Error(`Missing filmstrip for ${fileName}`);
    const frames = [...strip.querySelectorAll('.filmstrip-frame')];
    const image = frames.map(frame => frame.querySelector('img')).find(Boolean);
    const source = new Image(); source.src = image.currentSrc || image.src; await source.decode();
    const tile = frames[0].getBoundingClientRect(), box = strip.getBoundingClientRect();
    const lefts = frames.map(frame => parseFloat(frame.style.left)).sort((a, b) => a - b);
    const steps = lefts.slice(1).map((left, index) => left - lefts[index]);
    return { sourceRatio: source.naturalWidth / source.naturalHeight, tileRatio: tile.width / tile.height, tileHeight: tile.height, stripHeight: box.height, fit: getComputedStyle(image).objectFit, contiguous: steps.every(step => Math.abs(step - tile.width) < .5) };
  }, name);
}

try {
  // Uploads live in My media in Tracks mode; the editor opens in Agentic mode by default (57c304e).
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('revline-editor-mode', 'tracks'); } catch {} });
  await page.goto('http://localhost:3001/dev/editor', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready);
  const demo = await measure('weekend_outside.jpg');
  assert.ok(Math.abs(demo.tileRatio - demo.sourceRatio) < .01, `Original demo footage preserves its natural ratio: ${JSON.stringify(demo)}`);
  await (await page.$('.timeline-panel')).screenshot({ path: join(dir, 'timeline-media-fixed.png') }); // Keep runs from rewriting the tracked design reference.
  for (const [name, width, height] of [['portrait.png', 100, 200], ['landscape.png', 300, 100]]) {
    const data = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); context.fillStyle = '#e6ad39'; context.fillRect(0, 0, width, height);
      context.fillStyle = '#292929'; context.fillRect(width / 4, height / 4, width / 2, height / 2);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { width, height });
    const path = join(dir, name); await writeFile(path, Buffer.from(data, 'base64'));
    // My media imports to sources (8a70a16); clicking the source adds it to the timeline.
    if (!await page.$('.preview-inspector')) await page.click('[aria-label="Show editing panel"]');
    await page.waitForSelector('#inspector-media-tab'); await page.click('#inspector-media-tab'); await page.waitForSelector('#inspector-media [data-slot="button"]');
    await page.click('#inspector-media [data-slot="button"]'); await page.waitForSelector('.media-import-drop');
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('.media-import-drop')]); await chooser.accept([path]);
    await page.waitForSelector(`.asset-card[title="Add ${name} to timeline"]`);
    await until(() => !document.querySelector('.media-import-dialog') && getComputedStyle(document.body).pointerEvents !== 'none', undefined, 'The import dialog closes');
    await page.click(`.asset-card[title="Add ${name} to timeline"]`);
    await until(fileName => [...document.querySelectorAll('.clip-video')].some(node => node.getAttribute('aria-label')?.startsWith(fileName)), name, `${name} reaches the timeline`);
  }
  const results = [];
  for (const compact of [false, true]) {
    if (compact) await page.click('[aria-label="Compact track rows"]');
    for (const name of ['portrait.png', 'landscape.png']) {
      const measured = await measure(name);
      assert.ok(Math.abs(measured.tileRatio - measured.sourceRatio) < .01, `${name} stretched: source ratio ${measured.sourceRatio}, rendered tile ratio ${measured.tileRatio}`);
      assert.ok(Math.abs(measured.tileHeight - measured.stripHeight) < .1, 'Filmstrip tile fills the clip row height');
      assert.equal(measured.fit, 'contain', 'Frame images are never cropped or stretched');
      assert.ok(measured.contiguous, 'Frame tiles repeat side by side along the clip');
      results.push({ name, compact, ...measured });
    }
  }
  const preview = await page.evaluate(() => {
    const image = document.querySelector('hyperframes-player').iframeElement?.contentDocument?.querySelector('img.visual');
    return image ? { fit: getComputedStyle(image).objectFit, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight } : null;
  });
  assert.ok(preview, 'Preview image is mounted');
  assert.ok(['cover', 'contain'].includes(preview.fit) || Math.abs(preview.width / preview.height - preview.sourceWidth / preview.sourceHeight) < .001, 'Preview image preserves its intrinsic ratio');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, demo, results, preview }));
} finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
