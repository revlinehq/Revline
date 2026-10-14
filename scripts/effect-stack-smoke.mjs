import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle = await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: '__revlineVisualEffects', write: false });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=768'] });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="composition" data-width="640" data-height="360"><img id="clip-0" data-start="0" data-duration="3" style="position:absolute;width:640px;height:360px"></div>');
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext('2d'); context.fillStyle = 'rgb(128,128,128)'; context.fillRect(0, 0, 640, 360);
    const source = document.getElementById('clip-0'); source.src = canvas.toDataURL(); await source.decode();
    window.originalSource = source; window.originalUrl = source.src; window.time = 1.5;
    window.__timelines = { revline: { time: () => window.time, render() {} } };
    window.__hf = { colorGrading: { redraw() {} } };
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const dither = { enabled: true, amount: 1, levels: 2, size: 8 };
    const zoom = (amount, centerX = .5) => ({ enabled: true, amount, centerX, centerY: .5 });
    const fx = (id, track, settings) => ({ id, kind: 'effect', effectPreset: 'zoom-blur', sourceStart: 0, start: 1, duration: 1, track, zoomBlur: settings });
    const read = () => {
      const canvas = document.querySelector('.visual-effect-output'), gl = canvas.getContext('webgl');
      const data = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let intermediate = 0, checksum = 0;
      for (let index = 0; index < data.length; index += 4) { if (data[index] > 4 && data[index] < 251) intermediate++; checksum = (checksum + data[index] * (index + 1)) % 2147483647; }
      return { data, intermediate, checksum };
    };
    window.__revlineVisualEffects.installVisualEffects([{ id: 'clip-0', dither }], 30, 1080);
    const base = read();
    // Reference each downstream stage against the preceding rendered bitmap.
    async function reference(stages) {
      window.__revlineEffects.setTimedEffects([]);
      const source = document.getElementById('clip-0'); source.src = window.originalUrl; await source.decode();
      window.__revlineEffects.set('clip-0', { dither }); window.__revlineEffects.redraw();
      for (const settings of stages) {
        const preceding = document.querySelector('.visual-effect-output').toDataURL();
        source.src = preceding; await source.decode(); window.__revlineEffects.set('clip-0', { zoomBlur: settings }); window.__revlineEffects.redraw();
      }
      return read();
    }
    const expected = await reference([zoom(.75)]), duplicateExpected = await reference([zoom(.15), zoom(.15)]);
    const orderedExpected = await reference([zoom(.2, .15), zoom(.4, .8)]);
    const source = document.getElementById('clip-0'); source.src = window.originalUrl; await source.decode();
    window.__revlineEffects.set('clip-0', { dither });
    const canvas = document.querySelector('.visual-effect-output'), gl = canvas.getContext('webgl');
    window.__revlineEffects.setTimedEffects([fx('one', 1, zoom(.75))]);
    const actual = read(), maxDifference = (a, b) => a.reduce((difference, value, index) => Math.max(difference, Math.abs(value - b[index])), 0);
    window.__revlineEffects.setTimedEffects([fx('two', 2, zoom(.15)), fx('one', 1, zoom(.15))]);
    const duplicate = read();
    window.__revlineEffects.setTimedEffects([fx('higher', 2, zoom(.4, .8)), fx('lower', 1, zoom(.2, .15))]);
    const ordered = read();
    window.time = 2; window.__revlineEffects.redraw(); const ended = read();
    window.time = 1.5; window.__revlineEffects.setTimedEffects([]); const removed = read();
    window.__revlineEffects.setTimedEffects([fx('one', 1, zoom(.75))]);
    const injected = new Image(); injected.id = '__render_frame_clip-0__'; injected.src = window.originalUrl;
    source.parentElement.appendChild(injected); await injected.decode(); window.__hf.colorGrading.redraw(); const exported = read();
    const retained = source === window.originalSource && canvas === document.querySelector('.visual-effect-output') && gl === canvas.getContext('webgl');
    window.__revlineEffects.dispose();
    return {
      baseIntermediate: base.intermediate, actualIntermediate: actual.intermediate, expectedIntermediate: expected.intermediate,
      previousPassDifference: maxDifference(actual.data, expected.data), duplicateDifference: maxDifference(duplicate.data, duplicateExpected.data), orderDifference: maxDifference(ordered.data, orderedExpected.data), exportDifference: maxDifference(exported.data, expected.data),
      exactEnd: ended.checksum === base.checksum, deleteRestoresBase: removed.checksum === base.checksum, retained, cleaned: !document.querySelector('.visual-effect-output') && !source.hasAttribute('data-revline-effects'),
    };
  });
  console.log(JSON.stringify(result));
  assert.equal(result.baseIntermediate, 0);
  assert.ok(result.actualIntermediate > 100_000, 'Downstream blur must sample the dithered output, producing intermediate tones');
  for (const key of ['previousPassDifference', 'duplicateDifference', 'orderDifference', 'exportDifference']) assert.ok(result[key] <= 1, key + ' must match sequential rendered-bitmap reference');
  for (const key of ['exactEnd', 'deleteRestoresBase', 'retained', 'cleaned']) assert.equal(result[key], true, key);
  console.log('PASS: downstream blur samples prior pixels, duplicate FX compose in track order, same preview/export kernel, exact end/deletion, retained canvas/context/source, and cleanup. Synthetic shader pixels; no encoder job.');
} finally { await browser.close(); }
