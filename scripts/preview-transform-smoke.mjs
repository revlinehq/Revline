import assert from 'node:assert/strict';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import puppeteer from 'puppeteer-core';
import { homedir } from 'node:os';
import { join } from 'node:path';

const origin = process.env.REVLINE_TEST_ORIGIN || 'http://localhost:3001';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const installed = await getInstalledBrowsers({ cacheDir: process.env.PUPPETEER_CACHE_DIR || join(homedir(), '.cache/puppeteer') });
const chrome = installed.find(browser => browser.browser === 'chrome');
assert.ok(chrome, 'A local test Chrome is required.');
const browser = await puppeteer.launch({ executablePath: chrome.executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(condition, name, detail) { checks.push({ passed: !!condition, name, detail }); }

async function selectFixture(rotation = 0, crop = undefined, fit = 'contain') {
  await page.evaluate(({ rotation, crop, fit }) => {
    window.__previousFixturePlayer = [...document.querySelectorAll('hyperframes-player')].find(player => player.style.zIndex === '1');
    const element = document.querySelector('.timeline-scroll');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))], store;
    while (fiber) { if (fiber.memoizedProps?.store?.getState?.().timeline) { store = fiber.memoizedProps.store; break; } fiber = fiber.return; }
    if (!store) throw new Error('Canonical editor store not found');
    const original = store.getState().timeline.clips.find(clip => clip.kind === 'image' || clip.kind === 'video');
    const clip = { ...original, id: 'preview-fixture', start: 0, duration: 15, sourceStart: 0, fit, crop, transform: { x: .4, y: .55, scale: rotation ? .35 : .6, rotation, opacity: 1 } };
    store.getState().replace({ fps: 30, aspectRatio: 'vertical', tracks: { visual: 1, overlay: 0, audio: 0 }, clips: [clip] });
    store.setState({ selectedId: clip.id, selectedIds: [clip.id], playhead: 0 });
  }, { rotation, crop, fit });
  await page.waitForFunction(rotation => {
    const players = [...document.querySelectorAll('hyperframes-player')];
    return players.some(p => p !== window.__previousFixturePlayer && p.style.zIndex === '1' && p.ready && p.iframeElement?.contentDocument?.querySelector('[data-visual-clip="preview-fixture"]')?.style.transform.includes(`rotate(${rotation}deg)`));
  }, {}, rotation);
  await page.click('.preview-hit-surface', {count:2});
  await page.waitForSelector('.visual-selection-box');
  await wait(100);
}

async function geometry() {
  return page.evaluate(() => {
    const outer = document.querySelector('.visual-handles').getBoundingClientRect();
    const player = [...document.querySelectorAll('hyperframes-player')].find(p => p.style.zIndex === '1');
    const doc = player.iframeElement.contentDocument;
    const composition = doc.querySelector('#composition');
    const frame = doc.querySelector('[data-visual-clip="preview-fixture"]');
    const source = frame.querySelector('.source-window');
    const selection = document.querySelector('.visual-selection-box');
    const r = selection.getBoundingClientRect(), s = source.getBoundingClientRect();
    const sx = outer.width / Number(composition.dataset.width), sy = outer.height / Number(composition.dataset.height);
    const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
    const expected = { x: outer.x + s.x * sx, y: outer.y + s.y * sy, width: s.width * sx, height: s.height * sy };
    const handles = [...document.querySelectorAll('.visual-resize-layer .visual-corner')].map(el => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label'), x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height, cursor: getComputedStyle(el).cursor }; });
    const frameWidth = Number(composition.dataset.width), frameHeight = Number(composition.dataset.height);
    const matrix = new DOMMatrix(getComputedStyle(frame).transform);
    const expectedCorners = [['top left', 0, 0], ['top right', 1, 0], ['bottom left', 0, 1], ['bottom right', 1, 1]].map(([label, x, y]) => {
      const point = matrix.transformPoint({ x: source.offsetLeft + x * source.offsetWidth - frameWidth / 2, y: source.offsetTop + y * source.offsetHeight - frameHeight / 2 });
      return { label: `Resize ${label}`, x: outer.x + (frame.offsetLeft + frameWidth / 2 + point.x) * sx, y: outer.y + (frame.offsetTop + frameHeight / 2 + point.y) * sy };
    });
    return { rect, expected, expectedCorners, handles, outer: { x: outer.x, y: outer.y, width: outer.width, height: outer.height }, frameTransform: frame.style.transform };
  });
}

async function state() {
  return page.evaluate(() => {
    const element = document.querySelector('.timeline-scroll');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
    while (fiber) { const store = fiber.memoizedProps?.store; if (store?.getState?.().timeline) { const state = store.getState(); return { clip: state.timeline.clips[0], history: state.history.length }; } fiber = fiber.return; }
    throw new Error('Canonical editor store not found');
  });
}

function sameRect(actual, expected) { return ['x', 'y', 'width', 'height'].every(key => Math.abs(actual[key] - expected[key]) < 2); }
function outsideHandles(value) {
  return value.handles.every(handle => {
    const corner = value.expectedCorners.find(corner => corner.label === handle.label);
    const distance = Math.hypot(handle.x - corner.x, handle.y - corner.y);
    const center = { x: value.expected.x + value.expected.width / 2, y: value.expected.y + value.expected.height / 2 };
    return distance > 4 && distance < 9 && Math.abs(handle.width - 24) < .1 && Math.abs(handle.height - 24) < .1 && (handle.x - corner.x) * (corner.x - center.x) + (handle.y - corner.y) * (corner.y - center.y) > 0;
  });
}

try {
  await page.goto(`${origin}/dev/editor`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.timeline-scroll');
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready);
  await wait(500);
  await selectFixture();
  const contained = await geometry();
  check(sameRect(contained.rect, contained.expected), 'Contain-fit selection follows the actual media edges', { actual: contained.rect, expected: contained.expected });
  const corner = contained.handles.find(handle => handle.label === 'Resize bottom right');
  await page.mouse.move(corner.x, corner.y); await page.mouse.down();
  await page.mouse.move(corner.x + 20, corner.y + 20, { steps: 8 });
  const resized = await geometry();
  check(Math.abs(resized.expected.x - contained.expected.x) < 2 && Math.abs(resized.expected.y - contained.expected.y) < 2, 'Contain-fit resize anchors the actual opposite media corner', { before: contained.expected, after: resized.expected });
  await page.mouse.up();
  await selectFixture(90);
  const rotated = await geometry();
  check(rotated.handles.find(handle => handle.label === 'Resize bottom right')?.cursor === 'nesw-resize', 'Resize cursor follows a ninety-degree rotated corner', rotated.handles);
  check(sameRect(rotated.rect, rotated.expected) && outsideHandles(rotated), 'Rotated handles stay just outside actual corners with constant hit areas', { actual: rotated.rect, expected: rotated.expected, handles: rotated.handles, corners: rotated.expectedCorners });
  await selectFixture(30, { left: .25, top: .1, right: .05, bottom: .15 });
  const cropped = await geometry();
  check(sameRect(cropped.rect, cropped.expected) && outsideHandles(cropped), 'Noncentered cropped media uses its own rotated content bounds', { actual: cropped.rect, expected: cropped.expected });
  const resizeBefore = await state(), cornerBefore = cropped.expectedCorners.find(corner => corner.label === 'Resize top left');
  const resizeHandle = cropped.handles.find(handle => handle.label === 'Resize bottom right');
  await page.evaluate(() => { window.__liveFixturePlayer = [...document.querySelectorAll('hyperframes-player')].find(player => player.style.zIndex === '1'); });
  await page.mouse.move(resizeHandle.x, resizeHandle.y); await page.mouse.down();
  await page.mouse.move(resizeHandle.x + 12, resizeHandle.y + 20, { steps: 8 });
  const resizeLive = await geometry(), cornerLive = resizeLive.expectedCorners.find(corner => corner.label === 'Resize top left');
  check(Math.hypot(cornerLive.x - cornerBefore.x, cornerLive.y - cornerBefore.y) < 2, 'Rotated cropped resize anchors the opposite content corner', { before: cornerBefore, after: cornerLive });
  check(await page.evaluate(() => window.__liveFixturePlayer === [...document.querySelectorAll('hyperframes-player')].find(player => player.style.zIndex === '1')), 'Live resize updates the current preview without rebuilding it');
  await page.mouse.up(); await wait(200);
  const resizeAfter = await state();
  check(resizeAfter.history === resizeBefore.history + 1 && resizeAfter.clip.transform.scale > resizeBefore.clip.transform.scale, 'One resize commits one canonical undo entry', { before: resizeBefore, after: resizeAfter });
  await page.waitForFunction(() => [...document.querySelectorAll('hyperframes-player')].some(player => player.style.zIndex === '1' && player.ready && player !== window.__liveFixturePlayer));
  const cancelBefore = await state(), cancelGeometry = await geometry();
  await page.mouse.move(cancelGeometry.rect.x + cancelGeometry.rect.width / 2, cancelGeometry.rect.y + cancelGeometry.rect.height / 2); await page.mouse.down();
  await page.mouse.move(cancelGeometry.rect.x + cancelGeometry.rect.width / 2 + 16, cancelGeometry.rect.y + cancelGeometry.rect.height / 2 + 10, { steps: 6 });
  const movedLive = await geometry();
  check(movedLive.frameTransform === cancelGeometry.frameTransform && movedLive.expected.x > cancelGeometry.expected.x + 10, 'Move updates position live while preserving rotation and scale');
  await page.keyboard.press('Escape'); await page.mouse.up(); await wait(100);
  const canceled = await state(), restored = await geometry();
  check(JSON.stringify(canceled) === JSON.stringify(cancelBefore) && sameRect(restored.expected, cancelGeometry.expected), 'Escape cancels a transform without a history entry', { before: cancelBefore, after: canceled });
  await page.setViewport({ width: 1200, height: 850 }); await wait(150);
  const responsive = await geometry();
  check(sameRect(responsive.rect, responsive.expected) && outsideHandles(responsive), 'Preview resizing keeps content, selection and handle coordinates aligned', { actual: responsive.rect, expected: responsive.expected });
  await selectFixture(0, { left: .1, top: .1, right: .1, bottom: .1 }, 'cover');
  const covered = await geometry();
  check(sameRect(covered.rect, covered.expected), 'Cover-fit crop handles follow the rendered frame bounds', { actual: covered.rect, expected: covered.expected });
  await page.screenshot({ path: '/tmp/revline-preview-transform-check.png' });
  console.log(JSON.stringify(checks, null, 2));
  assert.deepEqual(errors, [], 'Preview browser errors');
  assert.ok(checks.every(result => result.passed), 'Preview transform geometry regressions');
} finally { await browser.close(); }
