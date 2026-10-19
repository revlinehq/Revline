import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001';
// For production measurements, point BASE_URL at a separately built `next start`
// server and set REACT_RUNTIME=production. `next dev` adds development overhead.
const declaredReactRuntime = process.env.REACT_RUNTIME ?? 'unspecified';
assert.ok(['production', 'development', 'unspecified'].includes(declaredReactRuntime), 'REACT_RUNTIME must describe the target server');
const scales = (process.env.CPU_SCALES ?? '1,4').split(',').map(Number);
const functionalOnly = process.env.FUNCTIONAL_ONLY === '1';
const browser = await puppeteer.launch({ executablePath: '/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const page = await browser.newPage(), errors = [], checks = [], measurements = [];
await page.setRequestInterception(true);
page.on('request', request => ['GET', 'HEAD', 'OPTIONS'].includes(request.method()) ? request.continue() : request.abort());
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, name, detail) => checks.push({ name, passed: !!condition, ...(detail === undefined ? {} : { detail }) });
const percentile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] : 0;
page.on('pageerror', error => errors.push(error.message));
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument(() => {
  const counters = window.__dragPerf = { active: false, callbacks: [], pointers: [], mutations: 0 };
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener, wrapped = new WeakMap();
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type !== 'pointermove' || !listener) return add.call(this, type, listener, options);
    let wrapper = wrapped.get(listener);
    if (!wrapper) { wrapper = function(event) { const start = performance.now(); try { return typeof listener === 'function' ? listener.call(this, event) : listener.handleEvent(event); } finally { if (counters.active) counters.callbacks.push(performance.now() - start); } }; wrapped.set(listener, wrapper); }
    return add.call(this, type, wrapper, options);
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) { return remove.call(this, type, type === 'pointermove' && listener ? wrapped.get(listener) ?? listener : listener, options); };
  document.addEventListener('pointermove', event => { if (counters.active) counters.pointers.push({ at: performance.now(), x: event.clientX, y: event.clientY }); }, true);
});

async function state(id = 'caption-0', side) {
  return page.evaluate(({ id, side }) => {
    const element = document.querySelector('.timeline-panel');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))], store;
    while (fiber) { if (fiber.memoizedProps?.store?.getState?.().timeline) store ??= fiber.memoizedProps.store; fiber = fiber.return; }
    if (!store) throw new Error('Existing custom editor store not found');
    const find = id => [...document.querySelectorAll('.timeline-clip:not(.timeline-floating-clip)')].find(node => node.dataset.clipId === id || node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))]?.key === id);
    const clip = find(id), selected = side ? clip?.querySelector(`.clip-trim.${side}`) : clip;
    const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const value = store.getState(), scroll = document.querySelector('.timeline-scroll');
    return { timeline: value.timeline, history: value.history.length, selected: value.selectedIds, playhead: value.playhead, playing: value.playing, zoom: value.zoom * 54, clip: selected ? box(selected) : null, viewport: box(scroll), scrollLeft: scroll.scrollLeft, scrollTop: scroll.scrollTop, rows: [...document.querySelectorAll('.timeline-track')].map(node => ({ group: node.dataset.group, layer: Number(node.dataset.layer), ...box(node) })), labels: [...document.querySelectorAll('.track-label')].filter(node => node.dataset.group).map(node => ({ group: node.dataset.group, layer: Number(node.dataset.layer ?? node.querySelector('.track-label-name')?.textContent.match(/\d+/)?.[0]), ...box(node) })) };
  }, { id, side });
}
async function recordStart(id, mode, point) {
  await page.evaluate(({ id, mode, point }) => {
    const data = window.__dragPerf;
    Object.assign(data, { active: true, callbacks: [], pointers: [], mutations: 0, samples: [], longTasks: [] });
    const find = () => [...document.querySelectorAll('.timeline-clip:not(.timeline-floating-clip)')].find(node => node.dataset.clipId === id || node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))]?.key === id);
    const initial = find()?.getBoundingClientRect();
    const offset = initial ? { x: point.x - initial.x, y: point.y - initial.y } : { x: 0, y: 0 };
    data.observer = new PerformanceObserver(list => data.longTasks.push(...list.getEntries().map(entry => entry.duration))); data.observer.observe({ type: 'longtask' });
    data.mutationsObserver = new MutationObserver(records => data.mutations += records.length); data.mutationsObserver.observe(document.querySelector('.timeline-panel'), { subtree: true, attributes: true, attributeFilter: ['style', 'class'], childList: true });
    const tick = at => {
      const pointer = data.pointers.at(-1), ghost = [...document.querySelectorAll('.timeline-floating-clip')].find(node => node.dataset.clipId === id), target = [...document.querySelectorAll('.timeline-destination-preview')].find(node => node.dataset.clipId === id), clip = find();
      const r = ghost?.getBoundingClientRect(), destination = target?.getBoundingClientRect(), c = clip?.getBoundingClientRect();
      const visible = node => !!node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0;
      const snapped = visible(document.querySelector('.timeline-snap-guide'));
      data.samples.push({ at, pointerAt: pointer?.at, ghostX: r?.x, ghostY: r?.y, ghostTransform: ghost?.style.transform, clipX: c?.x, clipWidth: c?.width, cursorError: pointer && r ? Math.hypot(r.x - pointer.x + offset.x, r.y - pointer.y + offset.y) : undefined, verticalError: pointer && r ? Math.abs(r.y - pointer.y + offset.y) : undefined, snapped, snapAlignmentError: snapped && r && destination ? Math.abs(r.x - destination.x) : undefined, ghostVisible: visible(ghost), targetVisible: visible(target) });
      data.frame = requestAnimationFrame(tick);
    };
    data.frame = requestAnimationFrame(tick);
  }, { id, mode, point });
}
async function recordEnd() {
  return page.evaluate(() => { const data = window.__dragPerf; data.active = false; cancelAnimationFrame(data.frame); data.observer.disconnect(); data.mutationsObserver.disconnect(); const { samples, longTasks, pointers, callbacks, mutations } = data; return { samples, longTasks, pointers, callbacks, mutations }; });
}
async function measureGesture(kind, scale) {
  const side = kind === 'head-trim' ? 'left' : kind === 'tail-trim' ? 'right' : undefined;
  const id = kind.includes('footage') || kind === 'new-row-below' ? 'shot-3' : kind === 'horizontal-title' ? 'title-1' : 'caption-0';
  const before = await state(id, side), rect = before.clip; assert.ok(rect, `Custom clip for ${kind}`);
  let point = { x: rect.x + (side ? rect.width / 2 : Math.min(30, rect.width / 2)), y: rect.y + rect.height / 2 }, delta = { x: 44, y: 0 };
  if (kind === 'head-trim') delta.x = 25;
  if (kind === 'tail-trim') delta.x = -35;
  if (kind === 'vertical-row') delta = { x: 0, y: before.rows.find(row => row.group === 'visual' && row.layer === 1).y + 15 - point.y };
  if (kind === 'new-row-above') delta = { x: 0, y: before.rows.find(row => row.group === 'visual' && row.layer === 3).y - 9 - point.y };
  if (kind === 'new-row-below') { const row = before.rows.find(row => row.group === 'visual' && row.layer === 1); delta = { x: 0, y: row.y + row.height + 12 - point.y }; }
  if (kind === 'header-reorder') { const row = before.labels.find(row => row.group === 'visual' && row.layer === 1), target = before.labels.find(row => row.group === 'visual' && row.layer === 2); point = { x: row.x + 25, y: row.y + row.height / 2 }; delta = { x: 0, y: target.y - 8 - point.y }; }
  await page.mouse.move(point.x, point.y); await wait(100);
  const metricsBefore = await page.metrics(); await recordStart(id, side ?? 'move', point); await page.mouse.down();
  const dispatch = [], start = performance.now();
  for (let index = 1; index <= 60; index++) { const delay = start + index * 1000 / 120 - performance.now(); if (delay > 0) await wait(delay); const sent = performance.now(); await page.mouse.move(point.x + delta.x * index / 60, point.y + delta.y * index / 60); dispatch.push(performance.now() - sent); }
  await wait(100); const result = await recordEnd(), held = await state(id), metricsAfter = await page.metrics();
  // Performance trials cancel rather than mutating the user's saved timeline or clock.
  await page.keyboard.press('Escape'); await page.mouse.up(); await wait(200); const restored = await state(id);
  const intervals = result.samples.slice(1).map((value, index) => value.at - result.samples[index].at), ghosts = result.samples.filter(value => value.ghostVisible);
  // The recorder's RAF can run before the app positions a newly appended clone
  // later in that same pre-paint cycle. Track this setup delay separately.
  const painted = ghosts.filter(value => !!value.ghostTransform && value.ghostTransform !== 'none');
  const firstGhostPaintMs = painted.length && ghosts.length ? painted[0].at - ghosts[0].at : Infinity;
  const tracked = painted.filter(value => value.pointerAt && value.cursorError !== undefined);
  const free = tracked.filter(value => !value.snapped), snapped = tracked.filter(value => value.snapped);
  const summary = { kind, scale, frames: result.samples.length, p95FrameMs: percentile(intervals, .95), maxFrameMs: Math.max(0, ...intervals), delayedFrames: intervals.filter(value => value > 34).length, longTasks: result.longTasks, pointerEvents: result.pointers.length, pointerCallbackCount: result.callbacks.length, p95PointerCallbackMs: percentile(result.callbacks, .95), p95DispatchMs: percentile(dispatch, .95), p95CursorErrorPx: percentile(ghosts.filter(value => value.cursorError !== undefined).map(value => value.cursorError), .95), prePaintGhostFrames: ghosts.length - painted.length, firstGhostPaintMs, paintedGhostFrames: painted.length, unsnappedFrames: free.length, p95UnsnappedCursorErrorPx: percentile(free.map(value => value.cursorError), .95), snappedFrames: snapped.length, maxSnapAlignmentErrorPx: Math.max(0, ...snapped.map(value => value.snapAlignmentError ?? Infinity)), p95VerticalErrorPx: percentile(tracked.map(value => value.verticalError), .95), ghostFrames: ghosts.length, targetFrames: result.samples.filter(value => value.targetVisible).length, domMutations: result.mutations, layouts: metricsAfter.LayoutCount - metricsBefore.LayoutCount, taskMs: (metricsAfter.TaskDuration - metricsBefore.TaskDuration) * 1000, heldHistory: held.history - before.history };
  measurements.push(summary); console.error(JSON.stringify(summary));
  check(result.pointers.length >= 50 && result.samples.length >= 15, `${scale}× ${kind}: samples actual held-pointer movement`, summary);
  check(summary.p95FrameMs < 50 && summary.p95PointerCallbackMs < 20, `${scale}× ${kind}: no repeated frame or pointer-handler stalls`, summary);
  check(JSON.stringify(restored.timeline) === JSON.stringify(before.timeline) && restored.history === before.history && Math.abs(restored.playhead - before.playhead) < 1e-6, `${scale}× ${kind}: cancel preserves document/history/playhead`);
  if (!side && kind !== 'header-reorder') {
    // A magnetic join deliberately locks X to the landing preview. Outside a
    // snap, both axes must still follow the cursor under the existing budget.
    check(summary.paintedGhostFrames > 10 && summary.firstGhostPaintMs < 50 && summary.targetFrames > 10 && summary.p95UnsnappedCursorErrorPx < 12 && summary.p95VerticalErrorPx < 12 && summary.maxSnapAlignmentErrorPx < 1, `${scale}× ${kind}: free drag follows the cursor and magnetic drag matches the landing preview`, summary);
  }
}

async function reset() {
  await page.goto(new URL('/dev/editor', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.custom-timeline');
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready);
  await page.evaluate(() => document.fonts.ready);
  await wait(250);
}
const clipPoint = value => ({ x: value.clip.x + Math.min(30, value.clip.width / 2), y: value.clip.y + value.clip.height / 2 });
async function hold(value, destination) {
  const point = clipPoint(value);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 12 }); await wait(80);
  return point;
}
async function functionalGestures() {
  await reset();
  const before = await state('title-1'), point = clipPoint(before);
  await hold(before, { x: point.x + 42, y: point.y });
  const held = await state('title-1');
  const landing = await page.$eval('.timeline-destination-preview[data-clip-id="title-1"]', node => { const r = node.getBoundingClientRect(); return { x: r.x, width: r.width }; });
  check(JSON.stringify(held.timeline) === JSON.stringify(before.timeline) && held.history === before.history, 'Held floating drag never writes canonical clips or undo');
  await page.mouse.up(); await wait(180);
  const committed = await state('title-1');
  check(committed.history === before.history + 1 && Math.abs(committed.clip.x - landing.x) < 1 && Math.abs(committed.clip.width - landing.width) < 1, 'Release commits the visible landing position in one edit');
  await page.click('[aria-label="Undo"]'); await wait(80);
  check(JSON.stringify((await state()).timeline) === JSON.stringify(before.timeline), 'One undo restores the complete drag');

  for (const cancellation of ['Escape', 'pointercancel', 'outside']) {
    await reset();
    const initial = await state('title-1'), start = clipPoint(initial);
    const destination = cancellation === 'outside' ? { x: initial.viewport.x + initial.viewport.width + 20, y: start.y } : { x: start.x + 60, y: start.y };
    await hold(initial, destination);
    if (cancellation === 'Escape') await page.keyboard.press('Escape');
    if (cancellation === 'pointercancel') await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    await page.mouse.up(); await wait(100);
    const restored = await state();
    check(JSON.stringify(restored.timeline) === JSON.stringify(initial.timeline) && restored.history === initial.history && !await page.$('.timeline-floating-clip,.timeline-destination-preview'), `${cancellation} cancels the floating drag without leftover previews`);
  }

  await reset();
  const headerBefore = await state(), header = headerBefore.labels.find(row => row.group === 'visual' && row.layer === 1);
  await page.mouse.move(header.x + 25, header.y + header.height / 2); await page.mouse.down();
  await page.mouse.move(header.x + 25, headerBefore.viewport.y - 90, { steps: 12 }); await page.mouse.up(); await wait(100);
  const headerAfter = await state();
  check(JSON.stringify(headerAfter.timeline) === JSON.stringify(headerBefore.timeline) && headerAfter.history === headerBefore.history, 'Dropping a track header outside the timeline cancels reordering');

  await reset();
  const original = await state(), start = clipPoint(original), top = original.rows.find(row => row.group === 'visual' && row.layer === 3);
  await hold(original, { x: start.x, y: top.y - 8 });
  check(await page.$$eval('.timeline-insert-indicator',nodes=>nodes.some(node=>getComputedStyle(node).display!=='none')), 'Dragging above previews a new visual row', {top, insertion:await page.$$eval('.timeline-insert-indicator',nodes=>nodes.map(n=>n.getAttribute('aria-label')))});
  await page.mouse.move(start.x + 14, start.y, { steps: 8 }); await wait(80);
  check(await page.$$eval('.timeline-insert-indicator',nodes=>nodes.every(node=>getComputedStyle(node).display==='none')), 'Returning to an existing row clears the insertion preview', await page.$$eval('.timeline-insert-indicator',nodes=>nodes.map(n=>({label:n.getAttribute('aria-label'),height:n.getBoundingClientRect().height}))));
  await page.mouse.up(); await wait(100);
  const returned = await state();
  check(returned.rows.length === original.rows.length && returned.history === original.history + 1 && returned.rows.filter(row => row.group === 'visual').length === original.rows.filter(row => row.group === 'visual').length, 'Hovering a new row then returning does not leave an empty track', { beforeRows: original.rows.length, afterRows: returned.rows.length, edits: returned.history - original.history });

  await reset();
  // Imported timelines may carry valid sub-frame offsets. A grouped drag must
  // preserve their relative timing, rather than independently rounding each clip.
  await page.evaluate(() => {
    const panel = document.querySelector('.timeline-panel'); let fiber = panel[Object.keys(panel).find(key => key.startsWith('__reactFiber$'))], store;
    while (fiber) { if (fiber.memoizedProps?.store?.getState?.().timeline) store ??= fiber.memoizedProps.store; fiber = fiber.return; }
    const timeline = store.getState().timeline;
    store.getState().replace({ ...timeline, tracks:{visual:2,overlay:0,audio:0}, clips: timeline.clips.filter(clip=>['caption-0','shot-3'].includes(clip.id)).map(clip => clip.id === 'caption-0' ? { ...clip, track:2,start: .15 } : { ...clip,track:1, start: 5.01 }) });
  });
  await wait(120);
  const caption = await state('caption-0'), footage = await state('shot-3');
  await page.mouse.click(clipPoint(caption).x, clipPoint(caption).y);
  await page.keyboard.down('Shift'); await page.mouse.click(clipPoint(footage).x, clipPoint(footage).y); await page.keyboard.up('Shift');
  const mixed = await state(), mixedStart = clipPoint(mixed);
  check(mixed.selected.includes('caption-0') && mixed.selected.includes('shot-3'), 'Shift selection includes text and footage together');
  await hold(mixed, { x: mixedStart.x + 42, y: mixedStart.y }); await page.mouse.up(); await wait(180);
  const moved = await state(), oldCaption = mixed.timeline.clips.find(clip => clip.id === 'caption-0'), oldFootage = mixed.timeline.clips.find(clip => clip.id === 'shot-3'), newCaption = moved.timeline.clips.find(clip => clip.id === 'caption-0'), newFootage = moved.timeline.clips.find(clip => clip.id === 'shot-3');
  check(moved.history === mixed.history + 1 && Math.abs((newCaption.start - oldCaption.start) - (newFootage.start - oldFootage.start)) < 1e-8 && newFootage.assetId === oldFootage.assetId && newCaption.text === oldCaption.text, 'Mixed text/footage drag preserves source metadata and the exact relative offset', {oldCaption,oldFootage,newCaption,newFootage,beforeHistory:mixed.history,afterHistory:moved.history});
  await page.click('[aria-label="Undo"]'); await wait(80);
  check(JSON.stringify((await state()).timeline) === JSON.stringify(mixed.timeline), 'One undo restores mixed selection including imported offsets');

  await reset();
  const first = await state();
  await page.mouse.click(first.viewport.x + first.zoom * 7, first.viewport.y + 8); await wait(100);
  const parked = await state(), next = await state('caption-1');
  await page.mouse.move(first.clip.x - 4, first.clip.y - 1); await page.mouse.down();
  await page.mouse.move(next.clip.x + next.clip.width + 2, first.clip.y + first.clip.height + 1, { steps: 12 }); await page.mouse.up(); await wait(100);
  const marquee = await state();
  check(marquee.selected.includes('caption-0') && marquee.selected.includes('caption-1') && marquee.history === parked.history && Math.abs(marquee.playhead - parked.playhead) < 1e-6, 'Mouse marquee selects multiple clips without moving the clock or creating undo');
  const labels = await page.$$eval('.time-ruler span', nodes => nodes.filter(node => node.textContent).map(node => node.textContent));
  check(labels[0] === '0s' && labels.some(label => label === '2s') && labels.every(label => label.includes('s')), 'Ruler labels explicitly identify seconds');
  const paused = await state(); await page.click('[aria-label="Zoom in"]'); await wait(100);
  const afterZoom = await state();
  const marker = await page.$eval('.playhead', node => new DOMMatrix(node.style.transform).m41);
  check(Math.abs(afterZoom.playhead - paused.playhead) < 1e-6 && Math.abs(marker - afterZoom.playhead * afterZoom.zoom) < 1, 'Paused scrub followed by zoom preserves time and marker alignment');

  await reset();
  await page.evaluate(()=>{const element=document.querySelector('.timeline-scroll');let fiber=element[Object.keys(element).find(key=>key.startsWith('__reactFiber$'))],store;while(fiber){if(fiber.memoizedProps?.store?.getState?.().timeline){store=fiber.memoizedProps.store;break;}fiber=fiber.return;}const timeline=store.getState().timeline;store.getState().replace({...timeline,tracks:{visual:2,overlay:0,audio:0},clips:timeline.clips.filter(clip=>['caption-0','shot-8'].includes(clip.id)).map(clip=>({...clip,track:clip.id==='caption-0'?2:1}))});});
  await wait(100);
  const clockInitial = await state();
  await page.keyboard.down('Alt'); await page.mouse.click(clockInitial.viewport.x + 4.466666667 * clockInitial.zoom, clockInitial.viewport.y + 8); await page.keyboard.up('Alt'); await wait(100);
  const live = await state(), liveStart = clipPoint(live);
  await hold(live, { x: liveStart.x + (4.4 - live.timeline.clips.find(clip => clip.id === 'caption-0').start) * live.zoom, y: liveStart.y });
  const snappedStart = await page.$eval('.timeline-destination-preview[data-clip-id="caption-0"]', node => new DOMMatrix(node.style.transform).m41);
  check(Math.abs(snappedStart - live.playhead * live.zoom) < 1, 'Clip magnet uses the current paused clock instead of the initial shell time', { playhead: live.playhead, snappedStart });
  await page.keyboard.press('Escape'); await page.mouse.up();
}

try {
  await reset(); await wait(750);
  const cdp = await page.createCDPSession();
  if (!functionalOnly) for (const scale of scales) { await cdp.send('Emulation.setCPUThrottlingRate', { rate: scale }); for (const kind of ['horizontal-title', 'horizontal-footage', 'vertical-row', 'new-row-above', 'new-row-below', 'head-trim', 'tail-trim', 'header-reorder']) await measureGesture(kind, scale); }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); if(process.env.PERF_ONLY!=='1')await functionalGestures();
  check(errors.length === 0, 'No browser runtime errors', errors);
  console.log(JSON.stringify({ target: { baseUrl, revision: process.env.TARGET_REVISION ?? null, declaredReactRuntime, cpuScales: scales, viewport: { width: 1440, height: 1000 }, fixture: 'Public in-memory sample editor; no AI calls or saved projects; non-read network methods blocked' }, passed: checks.every(value => value.passed), checks, measurements, errors }, null, 2));
  assert.ok(checks.every(value => value.passed), 'Custom timeline drag regression contains failing checks');
} finally { await browser.close(); }
