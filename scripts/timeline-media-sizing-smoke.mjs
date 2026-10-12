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

async function measure(name) {
  return page.evaluate(async fileName => {
    const clip = [...document.querySelectorAll('.clip-video')].find(node => node.getAttribute('aria-label')?.startsWith(fileName));
    const strip = clip?.querySelector('.filmstrip');
    if (!strip) throw new Error(`Missing filmstrip for ${fileName}`);
    const style = getComputedStyle(strip);
    const source = new Image();
    source.src = style.backgroundImage.slice(5, -2);
    await source.decode();
    const [width, height = 'auto'] = style.backgroundSize.split(' ');
    const box = strip.getBoundingClientRect();
    const size = (value, base) => value.endsWith('%') ? parseFloat(value) / 100 * base : parseFloat(value);
    const renderedHeight = height === 'auto' ? size(width, box.width) * source.naturalHeight / source.naturalWidth : size(height, box.height);
    const renderedWidth = width === 'auto' ? renderedHeight * source.naturalWidth / source.naturalHeight : size(width, box.width);
    return { sourceRatio: source.naturalWidth / source.naturalHeight, tileRatio: renderedWidth / renderedHeight, tileHeight: renderedHeight, stripHeight: box.height, repeat: style.backgroundRepeat };
  }, name);
}

try {
  await page.goto('http://localhost:3001/editor/demo', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready);
  const demo = await measure('weekend_outside.jpg');
  assert.ok(Math.abs(demo.tileRatio - demo.sourceRatio) < .001, 'Original demo footage preserves its natural ratio');
  await (await page.$('.timeline-panel')).screenshot({ path: 'design/implementation/timeline-media-fixed.png' });
  for (const [name, width, height] of [['portrait.png', 100, 200], ['landscape.png', 300, 100]]) {
    const data = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); context.fillStyle = '#e6ad39'; context.fillRect(0, 0, width, height);
      context.fillStyle = '#292929'; context.fillRect(width / 4, height / 4, width / 2, height / 2);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { width, height });
    const path = join(dir, name); await writeFile(path, Buffer.from(data, 'base64'));
    await (await page.$('input[type="file"]')).uploadFile(path);
    await page.waitForFunction(fileName => [...document.querySelectorAll('.clip-video')].some(node => node.getAttribute('aria-label')?.startsWith(fileName)), {}, name);
  }
  const results = [];
  for (const compact of [false, true]) {
    if (compact) await page.click('[aria-label="Compact track rows"]');
    for (const name of ['portrait.png', 'landscape.png']) {
      const measured = await measure(name);
      assert.ok(Math.abs(measured.tileRatio - measured.sourceRatio) < .001, `${name} stretched: source ratio ${measured.sourceRatio}, rendered tile ratio ${measured.tileRatio}`);
      assert.ok(Math.abs(measured.tileHeight - measured.stripHeight) < .1, 'Filmstrip tile fills the clip row height');
      assert.equal(measured.repeat, 'repeat-x');
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
