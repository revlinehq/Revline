import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const directory = mkdtempSync(join(tmpdir(), 'revline-live-effects-'));
const fixture = join(directory, 'footage.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fixture]);
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const settle = () => new Promise(resolve => setTimeout(resolve, 250));
try {
  await page.goto(process.env.BASE_URL ?? 'http://localhost:3001/editor/demo', { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    const element = document.querySelector('.timeline-scroll');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
    while (fiber) {
      const store = fiber.memoizedProps?.store;
      if (store?.getState?.().timeline) { window.testStore = store; break; }
      fiber = fiber.return;
    }
    const state = window.testStore.getState();
    state.edit({ ...state.timeline, clips: [], markers: [] });
  });
  await settle();
  await page.click('.project-import-stage button');
  await page.waitForSelector('input[type="file"]');
  await (await page.$('input[type="file"]')).uploadFile(fixture);
  await page.waitForFunction(() => window.testStore.getState().timeline.clips.some(clip => clip.kind === 'video'));
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready && document.querySelector('hyperframes-player')?.iframeElement?.contentDocument?.querySelector('video')?.readyState >= 2);
  await settle();
  await page.evaluate(() => {
    const state = window.testStore.getState();
    state.edit({ ...state.timeline, clips: [...state.timeline.clips, { id: 'test-caption', kind: 'caption', track: 2, start: 0, duration: 12, sourceStart: 0, text: 'Fast text effects', animation: 'none' }] });
  });
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.iframeElement?.contentDocument?.querySelector('.text-content')?.textContent === 'Fast text effects');
  await settle();
  await page.evaluate(() => {
    const p = document.querySelector('hyperframes-player');
    p.seek(2);
    const video = p.iframeElement.contentDocument.querySelector('video');
    window.previewBefore = { p, doc: p.iframeElement.contentDocument, video };
    window.previewReloads = 0;
    video.addEventListener('loadstart', () => window.previewReloads++);
    const clip = window.testStore.getState().timeline.clips.find(clip => clip.kind === 'video');
    window.testStore.setState({ selectedId: clip.id, selectedIds: [clip.id], playhead: 2 });
  });
  const patchText = async patch => {
    await page.evaluate(patch => { const s = window.testStore.getState(); s.edit({ ...s.timeline, clips: s.timeline.clips.map(c => c.id === 'test-caption' ? { ...c, ...patch } : c) }); }, patch);
    await settle();
  };
  await patchText({ animation: 'rise' });
  await settle();
  const check = async label => {
    const result = await page.evaluate(() => {
      const p = document.querySelector('hyperframes-player');
      return { samePlayer: p === window.previewBefore.p, sameDocument: p?.iframeElement.contentDocument === window.previewBefore.doc,
        sameVideo: p?.iframeElement.contentDocument.querySelector('video') === window.previewBefore.video,
        reloads: window.previewReloads, players: document.querySelectorAll('hyperframes-player').length, paused: p.paused,
        time: p.iframeElement.contentWindow.__timelines.revline.time() };
    });
    assert.equal(result.samePlayer, true, `${label}: keep the existing decoded player`);
    assert.equal(result.sameDocument, true, `${label}: keep the existing iframe document`);
    assert.equal(result.sameVideo, true, `${label}: keep the decoded video element`);
    assert.equal(result.reloads, 0, `${label}: do not reload media`);
    assert.equal(result.players, 1, `${label}: do not create a replacement player`);
    return result;
  };
  await check('add text rise');
  await patchText({ animation: 'fade' });
  await check('switch text fade');
  const fade = await page.evaluate(() => {
    const p = document.querySelector('hyperframes-player'), doc = p.iframeElement.contentDocument;
    const at = t => { p.seek(t); return Number(doc.defaultView.getComputedStyle(doc.querySelector('.text-content')).opacity); };
    return [at(0), at(.15), at(.3)];
  });
  assert.ok(fade[0] < .001 && fade[1] > 0 && fade[1] < 1 && fade[2] > .999, 'live fade renders deterministic intro frames');
  const key = (time, changes = {}) => ({ time, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1, ...changes });
  await patchText({ animation: 'none', motion: [key(0), key(1, { scale: 1.2 }), key(12)], motionOffset: 0 });
  await check('text motion keyframes');
  const peak = await page.evaluate(() => {
    const p = document.querySelector('hyperframes-player'); p.seek(1);
    const doc = p.iframeElement.contentDocument;
    return new DOMMatrix(doc.defaultView.getComputedStyle(doc.querySelector('.text-motion')).transform).a;
  });
  assert.ok(Math.abs(peak - 1.2) < .01, 'text animation updates immediately and reaches its new keyframe');
  await page.evaluate(() => { document.querySelector('hyperframes-player').play(); });
  await settle();
  const before = await check('playing before removal');
  assert.equal(before.paused, false);
  await patchText({ animation: 'none', motion: [] });
  const after = await check('remove text animation while playing');
  assert.equal(after.paused, false, 'effect editing preserves playback');
  assert.ok(after.time > before.time, 'the existing preview clock continues');
  const neutral = await page.evaluate(() => {
    const doc = document.querySelector('hyperframes-player').iframeElement.contentDocument;
    return new DOMMatrix(doc.defaultView.getComputedStyle(doc.querySelector('.text-motion')).transform).a;
  });
  assert.equal(neutral, 1, 'removing text animation clears the previous transform');
  console.log('PASS: add/change/remove text animations preserve player, document, decoded video and ongoing playback.');
} finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
