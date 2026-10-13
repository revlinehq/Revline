import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const directory = mkdtempSync(join(tmpdir(), 'revline-live-effects-'));
const fixture = join(directory, 'footage.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fixture]);
const demoUrl = new URL(process.env.BASE_URL ?? 'http://localhost:3001/editor/demo');
assert.ok(['localhost', '127.0.0.1'].includes(demoUrl.hostname) && demoUrl.pathname === '/editor/demo', 'Run only the isolated local in-memory demo');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors', '--enable-unsafe-swiftshader'] });
const context = await browser.createBrowserContext();
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', error => browserErrors.push(String(error)));
page.on('console', message => { if (message.type() === 'error' && message.text().includes('Revline visual effects')) browserErrors.push(message.text()); });
await page.setRequestInterception(true);
page.on('request', request => ['GET', 'HEAD', 'OPTIONS'].includes(request.method()) ? request.continue() : request.abort());
await page.setViewport({ width: 1600, height: 1000 });
const settle = () => new Promise(resolve => setTimeout(resolve, 250));
try {
  await page.goto(demoUrl.href, { waitUntil: 'networkidle2' });
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
  await page.click('.empty-upload button');
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
    await page.evaluate(patch => { const s = window.testStore.getState(); s.edit({ ...s.timeline, clips: s.timeline.clips.map(c => {
      if (c.id !== 'test-caption') return c;
      const next = { ...c, ...patch };
      if (patch.textTemplate === null) delete next.textTemplate;
      return next;
    }) }); }, patch);
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
  await page.evaluate(() => { const p = document.querySelector('hyperframes-player'); p.pause(); p.seek(.15); });
  for (const preset of ['word-reveal', 'word-pop', 'slide-title', 'karaoke']) {
    await patchText({ textTemplate: { preset, duration: 12, offset: 0 } });
    await check(`add ${preset} template`);
    const frame = await page.evaluate(() => document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelector('[data-remotion-text]').dataset.frame);
    assert.equal(frame, '4', `${preset} reads the existing exact composition time`);
  }
  await patchText({ text: 'Edited live template', color: '#ffcc00', fontSize: 72 });
  await check('edit template words, color and size');
  assert.equal(await page.evaluate(() => document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelector('.text-content').textContent), 'Edited live template');
  await patchText({ textTemplate: null, text: 'Plain text again', animation: 'fade' });
  await check('remove template and restore ordinary text');
  assert.equal(await page.evaluate(() => !!document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelector('[data-remotion-text]')), false);
  await patchText({ text: 'Edited plain text', color: '#00ffcc', fontSize: 64, animation: 'none' });
  await check('edit plain text words and style');
  const editedText = await page.evaluate(() => {
    const doc = document.querySelector('hyperframes-player').iframeElement.contentDocument, node = doc.querySelector('.overlay');
    return { text: node.textContent, color: doc.defaultView.getComputedStyle(node).color, size: doc.defaultView.getComputedStyle(node).fontSize };
  });
  assert.deepEqual(editedText, { text: 'Edited plain text', color: 'rgb(0, 255, 204)', size: '64px' });
  // Exercise the actual footage inspector gesture: pixels update before one committed edit.
  await page.evaluate(() => {
    const p = document.querySelector('hyperframes-player'); p.pause(); p.seek(2);
    const s = window.testStore.getState(), clip = s.timeline.clips.find(c => c.kind === 'video');
    window.testStore.setState({ selectedId: clip.id, selectedIds: [clip.id], playhead: 2 });
  });
  await page.click('#inspector-effects-tab');
  await page.click('.visual-effects-add');
  await page.waitForSelector('[role="menuitem"]');
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find(n => n.textContent.trim() === 'Color').click());
  await page.waitForSelector('input[aria-label="Exposure"]');
  await settle();
  await page.evaluate(() => {
    window.effectCommits = 0;
    window.stopEffectCount = window.testStore.subscribe((s, previous) => { if (s.timeline !== previous.timeline) window.effectCommits++; });
  });
  const slider = await page.$('input[aria-label="Exposure"]'), box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height / 2, { steps: 6 });
  await settle();
  const during = await page.evaluate(() => ({ value: window.testStore.getState().timeline.clips.find(c => c.kind === 'video').colorGrade.exposure,
    canvases: document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelectorAll('.visual-effect-output').length, commits: window.effectCommits }));
  assert.equal(during.value, 0, 'Dragging must not persist every slider tick');
  assert.equal(during.commits, 0, 'A drag keeps undo/save quiet until release');
  assert.equal(during.canvases, 1, 'Dragging immediately renders the effect');
  await page.mouse.up(); await settle();
  const committed = await page.evaluate(() => { window.stopEffectCount(); return { value: window.testStore.getState().timeline.clips.find(c => c.kind === 'video').colorGrade.exposure, commits: window.effectCommits }; });
  assert.ok(committed.value > .8, 'Release saves the previewed exposure');
  assert.equal(committed.commits, 1, 'One slider gesture is one timeline edit');
  const colorResult = await check('color slider gesture');
  assert.ok(Math.abs(colorResult.time - 2) < .1, 'A slider does not move the playhead');
  const patchVideo = async patch => { await page.evaluate(patch => { const s=window.testStore.getState();s.edit({...s.timeline,clips:s.timeline.clips.map(c=>c.kind==='video'?{...c,...patch}:c)}); },patch); await settle(); };
  const effectBeforePlay = await page.evaluate(() => document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelector('.visual-effect-output').toDataURL());
  await page.evaluate(() => document.querySelector('hyperframes-player').play()); await settle();
  const effectAfterPlay = await page.evaluate(() => document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelector('.visual-effect-output').toDataURL());
  assert.notEqual(effectAfterPlay, effectBeforePlay, 'A constant grade follows newly decoded video frames during playback');
  const playingVisual = await check('playing before visual updates');
  await patchVideo({ invert: { enabled: true, amount: 1 }, zoomBlur: { enabled: true, amount: .3, centerX: .5, centerY: .5 }, glitch: { enabled: true, intensity: .4, blockSize: 32, rgbSplit: 8 } });
  await check('add invert, zoom blur and glitch');
  await patchVideo({ zoomBlur: { enabled: true, amount: .6, centerX: .3, centerY: .7 } });
  await check('change zoom blur');
  await page.evaluate(() => { const s=window.testStore.getState();s.edit({...s.timeline,clips:s.timeline.clips.map(c=>{if(c.kind!=='video')return c;const {colorGrade,zoomBlur,glitch,invert,...rest}=c;return rest;})}); });
  await settle();
  const removedVisual = await check('remove visual effects while playing');
  assert.equal(removedVisual.paused, false);
  assert.ok(removedVisual.time > playingVisual.time, 'Visual edits preserve the running composition clock');
  assert.equal(await page.evaluate(() => document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelectorAll('.visual-effect-output').length), 0);
  await page.evaluate(() => { const p = document.querySelector('hyperframes-player'); p.pause(); p.seek(0); });
  for (const [rate, duration, time, sourceTime] of [[2, 6, 1, 2], [.5, 24, 2, 1]]) {
    await patchVideo({ playbackRate: rate, duration });
    await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready && document.querySelector('hyperframes-player')?.iframeElement?.contentDocument?.querySelector('video')?.readyState >= 2);
    await page.evaluate(time => document.querySelector('hyperframes-player').seek(time), time);
    await page.waitForFunction(sourceTime => { const v = document.querySelector('hyperframes-player')?.iframeElement?.contentDocument?.querySelector('video'); return v && !v.seeking && Math.abs(v.currentTime - sourceTime) < .05; }, {}, sourceTime);
    assert.equal(await page.evaluate(() => document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelector('video').playbackRate), rate, 'Native preview uses the clip speed');
  }
  assert.deepEqual(browserErrors, [], 'The editor effect runtime has no browser errors');
  console.log('PASS: text and visual effects preserve player, iframe, decoded media and playback; visual slider previews immediately and commits once; faster/slower footage seeks source time at its clip speed.');
} finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
