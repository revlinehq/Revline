import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const origin = process.env.REVLINE_TEST_ORIGIN ?? 'http://localhost:3001';
const browser = await puppeteer.launch({ executablePath: '/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const page = await browser.newPage(), checks = [], errors = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, name, detail) => checks.push({ passed: !!condition, name, detail });
page.on('pageerror', error => errors.push(error.message));
await page.setViewport({ width: 1440, height: 1000 });

async function fixture({ rotation = 0, x = .4, y = .55, scale = .6, crop } = {}) {
  await page.evaluate(options => {
    const element = document.querySelector('.timeline-scroll');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))], store;
    while (fiber) { if (fiber.memoizedProps?.store?.getState?.().timeline) { store = fiber.memoizedProps.store; break; } fiber = fiber.return; }
    if (!store) throw new Error('Existing editor provider not found');
    const original = store.getState().timeline.clips.find(clip => clip.kind === 'image' || clip.kind === 'video');
    window.__snapPreviousPlayer = [...document.querySelectorAll('hyperframes-player')].find(player => player.style.zIndex === '1');
    const clip = { ...original, id: 'snap-fixture', start: 0, duration: 15, sourceStart: 0, fit: 'contain', crop: options.crop, transform: { x: options.x, y: options.y, scale: options.scale, rotation: options.rotation, opacity: 1 } };
    store.getState().replace({ fps: 30, aspectRatio: 'vertical', tracks: { visual: 1, overlay: 0, audio: 0 }, clips: [clip] });
    store.setState({ selectedId: clip.id, selectedIds: [clip.id], playhead: 0 });
  }, { rotation, x, y, scale, crop });
  await page.waitForFunction(() => [...document.querySelectorAll('hyperframes-player')].some(player => player !== window.__snapPreviousPlayer && player.style.zIndex === '1' && player.ready && player.iframeElement?.contentDocument?.querySelector('[data-visual-clip="snap-fixture"]')));
  await page.waitForSelector('.visual-selection-box'); await wait(100);
}
async function geometry() {
  return page.evaluate(() => {
    const root = document.querySelector('.visual-handles').getBoundingClientRect(), box = document.querySelector('.visual-selection-box').getBoundingClientRect();
    const element = document.querySelector('.timeline-scroll'); let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
    while (fiber && !fiber.memoizedProps?.store?.getState?.().timeline) fiber = fiber.return;
    const state = fiber.memoizedProps.store.getState();
    const player = [...document.querySelectorAll('hyperframes-player')].find(player => player.style.zIndex === '1');
    return { root: { x: root.x, y: root.y, width: root.width, height: root.height }, box: { x: box.x, y: box.y, width: box.width, height: box.height }, guides: [...document.querySelectorAll('.visual-snap-guide')].map(line => ({ axis: line.dataset.axis, position: Number(line.dataset.position) })), transform: state.timeline.clips[0].transform, history: state.history.length, playerCount: document.querySelectorAll('hyperframes-player').length, renderedTransform: player.iframeElement.contentDocument.querySelector('[data-visual-clip="snap-fixture"]').style.transform };
  });
}
async function move(dx, dy, shift = false) {
  const before = await geometry(), x = before.box.x + before.box.width / 2, y = before.box.y + before.box.height / 2;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 8 });
  return before;
}

try {
  await page.goto(`${origin}/editor/demo`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready);
  await fixture(); const before = await geometry();
  await move(before.root.width * .1 - 3, -before.root.height * .05 + 3);
  const centered = await geometry();
  check(Math.abs(centered.box.x + centered.box.width / 2 - centered.root.x - centered.root.width / 2) < .6 && Math.abs(centered.box.y + centered.box.height / 2 - centered.root.y - centered.root.height / 2) < .6, 'Dragging near canvas center locks the visible media center on both axes', centered);
  check(centered.guides.some(line => line.axis === 'x') && centered.guides.some(line => line.axis === 'y'), 'Center magnets show transient alignment guides', centered.guides);
  check(centered.history === before.history && JSON.stringify(centered.transform) === JSON.stringify(before.transform), 'Live snapping leaves canonical state untouched');
  await page.mouse.up(); await wait(250); const committed = await geometry();
  check(committed.history === before.history + 1 && Math.abs(committed.transform.x - .5) < 1e-8 && Math.abs(committed.transform.y - .5) < 1e-8, 'Snapped movement commits one canonical transform', committed);
  check(committed.guides.length === 0, 'Pointer release clears alignment guides');
  await fixture(); const edgeBefore = await geometry();
  await move(edgeBefore.root.x - edgeBefore.box.x + 3, 0); const edgeLive = await geometry();
  check(Math.abs(edgeLive.box.x - edgeLive.root.x) < .6 && edgeLive.guides.some(line => line.axis === 'x' && line.position === 0), 'Visible media edge locks to the canvas boundary with an edge guide', edgeLive);
  await page.mouse.up(); await wait(250);
  const edgeAfter = await geometry();
  check(edgeAfter.history === edgeBefore.history + 1 && Math.abs(edgeAfter.box.x - edgeAfter.root.x) < .6, 'Committed edge alignment matches the rebuilt preview');
  await fixture(); const bypassBefore = await geometry();
  await move(bypassBefore.root.width * .1 - 3, -bypassBefore.root.height * .05 + 3, true); const bypassLive = await geometry();
  check(Math.abs(bypassLive.box.x + bypassLive.box.width / 2 - bypassLive.root.x - bypassLive.root.width / 2 + 3) < .6 && bypassLive.guides.length === 0, 'Shift permits precise free movement without magnetic guides', bypassLive);
  await page.mouse.up(); await page.keyboard.up('Shift'); await wait(250);
  await fixture(); const cancelBefore = await geometry();
  await move(cancelBefore.root.width * .1 - 3, -cancelBefore.root.height * .05 + 3);
  check((await geometry()).guides.length > 0, 'Cancellation starts from a real magnetic preview');
  await page.keyboard.press('Escape'); await page.mouse.up(); const canceled = await geometry();
  check(canceled.history === cancelBefore.history && JSON.stringify(canceled.transform) === JSON.stringify(cancelBefore.transform) && canceled.guides.length === 0 && Math.abs(canceled.box.x - cancelBefore.box.x) < .6, 'Escape restores original media and clears guides without an edit');
  await move(cancelBefore.root.width * .1 - 3, -cancelBefore.root.height * .05 + 3);
  const released = await page.evaluate(() => { const target = document.querySelector('.visual-selection-box'); const captured = target.hasPointerCapture(1); if (captured) target.releasePointerCapture(1); return captured; });
  await page.mouse.up(); await wait(50); const lost = await geometry();
  check(released && lost.history === cancelBefore.history && lost.guides.length === 0 && JSON.stringify(lost.transform) === JSON.stringify(cancelBefore.transform), 'Lost pointer capture cancels magnetic movement atomically');
  await fixture({ rotation: 30, scale: .35, crop: { left: .25, top: .1, right: .05, bottom: .15 } }); const rotatedBefore = await geometry();
  await move(rotatedBefore.root.x + rotatedBefore.root.width / 2 - rotatedBefore.box.x - rotatedBefore.box.width / 2 - 3, rotatedBefore.root.y + rotatedBefore.root.height / 2 - rotatedBefore.box.y - rotatedBefore.box.height / 2 + 3);
  const rotatedLive = await geometry();
  check(Math.abs(rotatedLive.box.x + rotatedLive.box.width / 2 - rotatedLive.root.x - rotatedLive.root.width / 2) < .6 && Math.abs(rotatedLive.box.y + rotatedLive.box.height / 2 - rotatedLive.root.y - rotatedLive.root.height / 2) < .6, 'Rotated cropped media snaps its visible content center', rotatedLive);
  await page.mouse.up(); await wait(250);
  await fixture({ x: .3, y: .3, scale: .4 }); const resizeBefore = await geometry();
  const resizeHandle = await page.$eval('[aria-label="Resize bottom right"]', element => { const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; });
  const dx = resizeBefore.root.x + resizeBefore.root.width - resizeBefore.box.x - resizeBefore.box.width - 3;
  const dy = dx * resizeBefore.box.height / resizeBefore.box.width;
  await page.mouse.move(resizeHandle.x, resizeHandle.y); await page.mouse.down(); await page.mouse.move(resizeHandle.x + dx, resizeHandle.y + dy, { steps: 12 });
  const resizeLive = await geometry();
  check(Math.abs(resizeLive.box.x - resizeBefore.box.x) < .6 && Math.abs(resizeLive.box.y - resizeBefore.box.y) < .6, 'Magnetic resize preserves the opposite visible corner');
  check(Math.abs(resizeLive.box.x + resizeLive.box.width - resizeLive.root.x - resizeLive.root.width) < .6 && resizeLive.guides.some(line => line.axis === 'x' && line.position > 0), 'Uniform resize locks to the canvas edge and shows its guide', resizeLive);
  await page.mouse.up(); await wait(250); const resizeAfter = await geometry();
  check(resizeAfter.history === resizeBefore.history + 1 && resizeAfter.guides.length === 0, 'Magnetic resize commits once and clears guides');
  for (const width of [1200, 390]) {
    await page.setViewport({ width, height: 850 }); await wait(150); await fixture(); const responsive = await geometry();
    await move(responsive.root.width * .1 - 3, -responsive.root.height * .05 + 3); const live = await geometry();
    check(Math.abs(live.box.x + live.box.width / 2 - live.root.x - live.root.width / 2) < .6 && live.guides.some(line => line.axis === 'x'), `A 3px magnetic reach stays usable at ${width}px viewport`, live.root);
    await page.mouse.up(); await wait(200);
  }
  console.log(JSON.stringify({ passed: checks.every(check => check.passed), checks, errors }, null, 2));
  assert.deepEqual(errors, []); assert.ok(checks.every(check => check.passed), 'Preview edge/center snapping regression');
} finally { await browser.close(); }
