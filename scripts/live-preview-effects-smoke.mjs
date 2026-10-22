import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { tsImport } from 'tsx/esm/api';
const compositionModule = await tsImport('../lib/editor/composition.ts', import.meta.url);
const generateComposition = compositionModule.generateComposition ?? compositionModule.default.generateComposition;

const directory = mkdtempSync(join(tmpdir(), 'revline-live-effects-'));
const fixture = join(directory, 'footage.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fixture]);
const demoUrl = new URL(process.env.BASE_URL ?? 'http://localhost:3001/dev/editor');
assert.ok(['localhost', '127.0.0.1'].includes(demoUrl.hostname) && demoUrl.pathname === '/dev/editor', 'Run only the isolated local in-memory demo');
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
    // Fade opacity is combined with clip motion on the live text layer's .text-motion wrapper (textLayerFrame).
    const at = t => { p.seek(t); return Number(doc.defaultView.getComputedStyle(doc.querySelector('.text-content').closest('.text-motion')).opacity); };
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
  await page.evaluate(() => {
    const p = document.querySelector('hyperframes-player'), doc = p.iframeElement.contentDocument;
    const index = window.testStore.getState().timeline.clips.findIndex(clip => clip.id === 'test-caption');
    const animation = doc.defaultView.__revlineTextLayerController;
    window.acknowledgementBefore = { node: doc.querySelector('.text-motion'), animation };
    const state = window.testStore.getState();
    // A server acknowledgement has equal values with fresh nested arrays and objects.
    state.replace(JSON.parse(JSON.stringify(state.timeline)));
  });
  await settle();
  await check('equal save acknowledgement');
  const unchangedAnimation = await page.evaluate(() => {
    const doc = document.querySelector('hyperframes-player').iframeElement.contentDocument;
    const before = window.acknowledgementBefore;
    return { sameNode: doc.querySelector('.text-motion') === before.node,
      sameTweens: doc.defaultView.__revlineTextLayerController === before.animation,
      scale: new DOMMatrix(doc.defaultView.getComputedStyle(doc.querySelector('.text-motion')).transform).a };
  });
  assert.equal(unchangedAnimation.sameNode, true, 'A save acknowledgement retains the text layer');
  assert.equal(unchangedAnimation.sameTweens, true, 'Equal saved motion retains the running animation program');
  assert.ok(Math.abs(unchangedAnimation.scale - 1.2) < .01, 'Equal saved motion retains the rendered frame');
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
  // Visual effects are added from the Tools library (c55d5b2); the panel starts collapsed to the tools rail (e832836).
  const library = async category => {
    if (await page.$('[aria-label="Expand editing panel"]')) await page.click('[aria-label="Expand editing panel"]');
    await page.waitForSelector('#inspector-tools-tab'); await page.click('#inspector-tools-tab');
    await page.waitForSelector('.effect-library'); await page.click(`[data-category="${category}"]`);
  };
  await library('color');
  await page.click('.library-look[aria-label="Color & light"]');
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
  // Timed presets come from the Motion library; the new effect is selected and its settings open from the library heading.
  await library('motion');
  await page.click('.library-look[aria-label="Cinema bars"]');
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.iframeElement?.contentDocument?.querySelector('.cinematic-bar'));
  await page.click('.inspector-library-heading button');
  await page.waitForSelector('input[aria-label="Size"]');
  await page.waitForSelector('input[aria-label="Speed"]');
  await settle();
  const barClip = await page.evaluate(() => {
    const p = document.querySelector('hyperframes-player'), video = p.iframeElement.contentDocument.querySelector('video');
    window.previewBefore = { p, doc: p.iframeElement.contentDocument, video }; window.previewReloads = 0;
    video.addEventListener('loadstart', () => window.previewReloads++);
    return window.testStore.getState().timeline.clips.find(clip => clip.effectPreset === 'cinematic-bars');
  });
  assert.equal(barClip.duration, 2, 'Bars have a usable default duration');
  const barAt = async time => page.evaluate(time => {
    const p = document.querySelector('hyperframes-player'); p.pause(); p.seek(time);
    const doc = p.iframeElement.contentDocument, bar = doc.querySelector('.cinematic-bar.top'), style = doc.defaultView.getComputedStyle(bar);
    const height = Number.parseFloat(style.height);
    return { time: doc.defaultView.__timelines.revline.time(), size: height / Number(doc.querySelector('#composition').dataset.height), coverage: 1 - Math.abs(new DOMMatrix(style.transform).m42) / height };
  }, time);
  assert.ok(Math.abs((await barAt(barClip.start + .2)).coverage - .5) < .01, 'Normal bars are halfway in after 0.2 seconds');
  assert.ok(Math.abs((await barAt(barClip.start + .4)).coverage - 1) < .01, 'Normal bars enter in 0.4 seconds');
  // Drag the actual effect end by two seconds; longer hold must preserve entrance speed.
  const handle = await page.$(`[data-clip-id="${barClip.id}"] .clip-trim.right`), handleBox = await handle.boundingBox();
  const px = await page.evaluate(() => Number.parseFloat(document.querySelector('.time-ruler').style.getPropertyValue('--ruler-unit')));
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 2 * px, handleBox.y + handleBox.height / 2, { steps: 8 }); await page.mouse.up(); await settle();
  const stretched = await page.evaluate(() => window.testStore.getState().timeline.clips.find(clip => clip.effectPreset === 'cinematic-bars'));
  assert.ok(Math.abs(stretched.duration - 4) < .04, 'Stretching changes the bar end/hold time');
  await check('stretch bars within the existing edit');
  assert.ok(Math.abs((await barAt(stretched.start + .2)).coverage - .5) < .01, 'Stretching does not slow entrance movement');
  assert.ok(Math.abs((await barAt(stretched.start + stretched.duration - .2)).coverage - .5) < .01, 'Stretching preserves a 0.4-second exit');
  await page.focus('input[aria-label="Size"]'); await page.keyboard.press('End'); await settle();
  await check('change bar size');
  assert.ok(Math.abs((await barAt(stretched.start + 1)).size - .5) < .001, 'The selected Size control changes each bar height');
  await page.focus('input[aria-label="Speed"]'); await page.keyboard.press('End'); await settle();
  await check('change bar movement speed');
  const rapidFirstFrame = await barAt(stretched.start + 1 / 30);
  const savedSpeed = await page.evaluate(() => window.testStore.getState().timeline.clips.find(clip => clip.effectPreset === 'cinematic-bars').cinematicBars.speed);
  assert.equal(savedSpeed, 4, 'The selected Speed control saves its multiplier');
  assert.ok(Math.abs(rapidFirstFrame.coverage - .148148) < .01, '4× speed renders the first 30-fps frame at its correct eased position');
  assert.ok(Math.abs((await barAt(stretched.start + .1)).coverage - 1) < .01, '4× speed enters in 0.1 seconds');
  // Zoom In/Out/Punch are one library entry that adds quick-zoom-in (17ce5f6).
  await library('motion');
  await page.click('.library-look[aria-label="Zoom"]');
  await page.waitForFunction(() => window.testStore.getState().timeline.clips.some(clip => clip.effectPreset === 'quick-zoom-in'));
  await page.evaluate(() => {
    const state = window.testStore.getState();
    state.edit({ ...state.timeline, clips: state.timeline.clips.map(clip => clip.id === 'test-caption' ? { ...clip, track: 24 } : clip.effectPreset === 'cinematic-bars' ? { ...clip, track: 1 } : clip.effectPreset === 'quick-zoom-in' ? { ...clip, track: 2 } : clip) });
  });
  await page.waitForFunction(() => {
    const doc = document.querySelector('hyperframes-player')?.iframeElement?.contentDocument;
    return doc?.querySelectorAll('[data-effect-clip]').length === 2 && doc.querySelector('.overlay')?.dataset.trackIndex === '23';
  });
  await settle();
  const snapshot = await page.evaluate(() => {
    const timeline = window.testStore.getState().timeline, doc = document.querySelector('hyperframes-player').iframeElement.contentDocument;
    const videoClip = timeline.clips.find(clip => clip.kind === 'video'), video = doc.querySelector('video');
    return { timeline, assets: [{ _id: videoClip.assetId, fileName: 'generated.mp4', kind: 'video', width: 320, height: 180, duration: 12, url: video.src }],
      barsId: timeline.clips.find(clip => clip.effectPreset === 'cinematic-bars').id,
      zoomId: timeline.clips.find(clip => clip.effectPreset === 'quick-zoom-in').id };
  });
  const exported = generateComposition(snapshot.timeline, snapshot.assets);
  const sharedStack = await page.evaluate(({ exported, barsId, zoomId }) => {
    const preview = document.querySelector('hyperframes-player').iframeElement.contentDocument;
    const output = new DOMParser().parseFromString(exported, 'text/html');
    const inspect = doc => {
      const bars = doc.querySelector(`[data-effect-clip="${barsId}"]`), zoom = doc.querySelector(`[data-effect-clip="${zoomId}"]`);
      return !!bars && !!zoom && zoom.contains(bars) && bars.contains(doc.querySelector('video')) && bars.contains(doc.querySelector('.overlay'));
    };
    return { preview: inspect(preview), export: inspect(output) };
  }, { exported, barsId: snapshot.barsId, zoomId: snapshot.zoomId });
  assert.deepEqual(sharedStack, { preview: true, export: true }, 'FX2 wraps FX1; both apply to the entire footage/text composite in preview and export');
  assert.deepEqual(browserErrors, [], 'The editor effect runtime has no browser errors');
  console.log('PASS: text and visual effects preserve player/media/clock; saved text keeps its animation; sliders preview and commit once; footage speed maps source time; bar controls update size/speed and stretching extends hold without slowing movement or replacing the player; FX preview/export share the complete video/text composite.');
} finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
