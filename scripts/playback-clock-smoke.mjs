import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001';
const cpuScale = Number(process.env.CPU_SCALE ?? 1);
const scrubOnly = process.env.SCRUB_ONLY === '1';
const browser = await puppeteer.launch({ executablePath: '/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const page = await browser.newPage(), errors = [], checks = [], measurements = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const expect = (condition, name, detail) => checks.push({ name, passed: !!condition, ...(detail === undefined ? {} : { detail }) });
page.on('pageerror', error => errors.push(error.message));
await page.setViewport({ width: 1440, height: 1000 });
// The timeline toolbar hosts the shared transport readout (.preview-time) whenever playbackControls are passed;
// .timeline-playback-time only renders without them.
// Inspect the existing project store, rather than exposing a test-only app store.
async function state(id = 'caption-0') {
  return page.evaluate(id => {
    const element = document.querySelector('.timeline-panel');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))], store;
    while (fiber) {
      if (fiber.memoizedProps?.store?.getState?.().timeline) store ??= fiber.memoizedProps.store;
      fiber = fiber.return;
    }
    if (!store) throw new Error('Existing project store not found');
    const viewport = document.querySelector('.timeline-scroll'), surface = viewport.getBoundingClientRect();
    const rect = document.querySelector(`.timeline-clip[data-clip-id="${id}"]:not(.timeline-floating-clip)`)?.getBoundingClientRect();
    const player = document.querySelector('hyperframes-player');
    const actual = player.iframeElement.contentWindow.__timelines.revline.time();
    const parse = text => { const [minutes, seconds, frames] = text.split(' / ')[0].split(':').map(Number); return minutes * 60 + seconds + frames / store.getState().timeline.fps; };
    return { timeline: store.getState().timeline, history: store.getState().history.length, playhead: store.getState().playhead, playing: store.getState().playing, actual, previewTime: parse(document.querySelector('.preview-time').textContent), timelineTime: parse((document.querySelector('.timeline-playback-time') ?? document.querySelector('.timeline-toolbar .preview-time')).textContent), zoom: store.getState().zoom * 54, surface: { x: surface.x, y: surface.y }, clip: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null };
  }, id);
}
async function select(id) { const value = await state(id); assert.ok(value.clip); await page.mouse.click(value.clip.x + value.clip.width / 2, value.clip.y + value.clip.height / 2); await wait(150); }
async function playback(kind) {
  const before = await state();
  const metricsBefore = await page.metrics();
  const result = await page.evaluate(() => new Promise(resolve => {
    const player = document.querySelector('hyperframes-player'), head = document.querySelector('.playhead');
    const actual = () => player.iframeElement.contentWindow.__timelines.revline.time();
    const parse = text => { const [m, s, f] = text.split(' / ')[0].split(':').map(Number); return (m * 60 + s) * 30 + f; };
    const samples = [], tasks = [];
    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({ type: 'longtask' });
    let trackMutations = 0;
    const mutations = new MutationObserver(records => { trackMutations += records.filter(record => !record.target.closest?.('.playhead,.timeline-playhead-cap')).length; });
    mutations.observe(document.querySelector('.timeline-track-area'), { subtree: true, attributes: true, attributeFilter: ['style', 'class'], childList: true });
    player.play();
    let start;
    function tick(now) {
      start ??= now;
      samples.push({ at: now - start, actual: actual(), head: new DOMMatrix(head.style.transform).m41, preview: parse(document.querySelector('.preview-time').textContent), timeline: parse((document.querySelector('.timeline-playback-time') ?? document.querySelector('.timeline-toolbar .preview-time')).textContent) });
      if (now - start < 1600) requestAnimationFrame(tick);
      else { observer.disconnect(); mutations.disconnect(); player.pause(); resolve({ samples, tasks, trackMutations }); }
    }
    requestAnimationFrame(tick);
  }));
  const metricsAfter = await page.metrics();
  await wait(80);
  const paused = await state(), samples = result.samples;
  const intervals = samples.slice(1).map((sample, index) => sample.at - samples[index].at).sort((a, b) => a - b);
  const changes = key => samples.slice(1).filter((sample, index) => sample[key] !== samples[index][key]).length;
  const compositionFrames = new Set(samples.map(sample => Math.floor(sample.actual * 30))).size - 1;
  const p95 = intervals[Math.floor(intervals.length * .95)];
  measurements.push({ kind, cpuScale, frames: samples.length, p95, max: Math.max(...intervals), longTasks: result.tasks, trackMutations: result.trackMutations, cpuTaskMs: (metricsAfter.TaskDuration - metricsBefore.TaskDuration) * 1000, scriptMs: (metricsAfter.ScriptDuration - metricsBefore.ScriptDuration) * 1000, layouts: metricsAfter.LayoutCount - metricsBefore.LayoutCount });
  expect(changes('head') >= samples.length * .7, `${kind}: custom marker advances on animation frames`);
  expect(changes('preview') >= compositionFrames * .85 && changes('timeline') >= compositionFrames * .85, `${kind}: both counters follow composition frames`, { compositionFrames, preview: changes('preview'), timeline: changes('timeline') });
  expect(samples.every(sample => Math.abs(sample.preview - Math.floor(sample.actual * 30)) <= 2 && Math.abs(sample.timeline - Math.floor(sample.actual * 30)) <= 2), `${kind}: displayed frames stay synchronized`);
  expect(result.trackMutations === 0, `${kind}: clock ticks do not rebuild static clip DOM`, result.trackMutations);
  expect(paused.history === before.history && !paused.playing, `${kind}: playback does not create edits`);
  expect(Math.abs(paused.playhead - paused.actual) < 1 / 30 && Math.abs(paused.previewTime - paused.actual) < 1 / 30 && Math.abs(paused.timelineTime - paused.actual) < 1 / 30, `${kind}: pause preserves the exact frame`, paused.actual);
  // Throttled stress checks supplement deterministic invalidation assertions.
  expect(p95 < 50, `${kind}: steady playback avoids repeated long frame delays`, p95);
}

async function scrub(kind, cdp) {
  const before = await state();
  if (process.env.SCRUB_PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  const metricsBefore = await page.metrics();
  const recording = page.evaluate(() => new Promise(resolve => {
    const frames = [], tasks = []; let last = performance.now(), frame;
    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration))); observer.observe({ type: 'longtask' });
    const tick = now => { frames.push(now - last); last = now; frame = requestAnimationFrame(tick); }; frame = requestAnimationFrame(tick);
    setTimeout(() => { cancelAnimationFrame(frame); observer.disconnect(); resolve({ frames: frames.slice(1).sort((a, b) => a - b), tasks }); }, 1800);
  }));
  await page.mouse.move(before.surface.x + 4, before.surface.y + 8); await page.mouse.down();
  for (let index = 0; index < 45; index++) { await page.mouse.move(before.surface.x + 4 + index * 4, before.surface.y + 8); await wait(16); }
  await page.mouse.up();
  const result = await recording, metricsAfter = await page.metrics(), after = await state();
  const p95 = result.frames[Math.floor(result.frames.length * .95)];
  let functions;
  if (process.env.SCRUB_PROFILE) {
    const { profile } = await cdp.send('Profiler.stop'); await writeFile(`${process.env.SCRUB_PROFILE}-${kind}.json`, JSON.stringify(profile));
    const nodes = new Map(profile.nodes.map(node => [node.id, node])), counts = new Map();
    for (const id of profile.samples ?? []) { const frame = nodes.get(id)?.callFrame; const key = `${frame?.functionName ?? '(unknown)'} ${frame?.url ?? ''}:${frame?.lineNumber ?? 0}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
    functions = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 15);
  }
  measurements.push({ kind: `scrub-${kind}`, cpuScale, frames: result.frames.length, p95, max: Math.max(...result.frames), longTasks: result.tasks, cpuTaskMs: (metricsAfter.TaskDuration - metricsBefore.TaskDuration) * 1000, layouts: metricsAfter.LayoutCount - metricsBefore.LayoutCount, ...(functions ? { functions } : {}) });
  expect(p95 < 50, `${kind}: pointer scrubbing avoids repeated long frame delays`, p95);
  expect(after.history === before.history && !after.playing && Math.abs(after.actual - after.playhead) < 1 / 30 && Math.abs(after.playhead * after.timeline.fps - Math.round(after.playhead * after.timeline.fps)) < 1e-6, `${kind}: scrubbing preserves one quantized clock without an edit`);
  return after;
}

try {
  await page.goto(new URL('/dev/editor', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready);
  await page.evaluate(() => document.fonts.ready);
  await wait(1500);
  const cdp = await page.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuScale });
  if (!scrubOnly) {
    await playback('unselected');
    await select('caption-0');
    await playback('selected');
    const clip = await state('caption-0');
    await page.mouse.move(clip.clip.x + clip.clip.width / 2, clip.clip.y + clip.clip.height / 2); await page.mouse.down();
    await page.mouse.move(clip.clip.x + clip.clip.width / 2 + 10, clip.clip.y + clip.clip.height / 2, { steps: 12 }); await page.mouse.up();
    await wait(1200);
    expect((await state()).history === clip.history + 1, 'A real clip drag precedes the post-drag playback case');
    await playback('after-drag');
  }
  const empty = await page.$eval('.timeline-track[data-group="audio"]', node => { const r = node.getBoundingClientRect(); return { x: r.x + 5, y: r.y + r.height / 2 }; });
  await page.mouse.click(empty.x, empty.y); await wait(100);
  await scrub('unselected', cdp); await select('caption-0');
  const afterScrub = await scrub('selected', cdp);
  // Programmatic cut navigation must update the custom marker without a shell time subscription.
  await page.click('[aria-label="Next cut"]'); await wait(80); const nextCut = await state();
  expect(nextCut.playhead > afterScrub.playhead && Math.abs(nextCut.playhead - nextCut.actual) < 1 / 30 && Math.abs(nextCut.timelineTime - nextCut.actual) < 1 / 30, 'Next cut updates marker, preview and counter');
  await page.click('[aria-label="Previous cut"]'); await wait(80); const previousCut = await state();
  expect(previousCut.playhead < nextCut.playhead && Math.abs(previousCut.playhead - previousCut.actual) < 1 / 30, 'Previous cut updates the custom marker');
  // A split performed while playing must use the live clock, not the last parked frame.
  const target = await state('shot-3');
  await page.mouse.click(target.surface.x + (target.timeline.clips.find(clip => clip.id === 'shot-3').start + .2) * target.zoom, target.surface.y + 8); await select('shot-3');
  await page.click('[aria-label="Play (Space)"]'); await wait(220); const live = await state('shot-3');
  // The toolbar split button was removed (c0e6acd); the S shortcut runs the same live-clock split.
  await page.keyboard.press('s'); await wait(350); const split = await state('shot-3');
  const original = live.timeline.clips.find(clip => clip.id === 'shot-3'), left = split.timeline.clips.find(clip => clip.id === 'shot-3');
  expect(left.duration < original.duration && left.start + left.duration > original.start + .25 && Math.abs(left.start + left.duration - live.actual) < .3, 'Split reads the live playback clock', { live: live.actual, split: left.start + left.duration });
  await page.evaluate(() => document.querySelector('hyperframes-player').pause());
  await select('shot-6'); const selectedVisual = await state('shot-6');
  const visualClip = selectedVisual.timeline.clips.find(clip => clip.id === 'shot-6');
  await page.mouse.click(selectedVisual.surface.x + (visualClip.start + .2) * selectedVisual.zoom, selectedVisual.surface.y + 8); await wait(80);
  // Transform handles need explicit preview activation (81b883d); keyboard activation hits the visible footage at the
  // canvas center without the double-click that also opens Clip settings (ab82c81).
  await page.focus('.preview-hit-surface'); await page.keyboard.press('Enter'); await page.evaluate(() => document.activeElement?.blur()); await wait(80);
  expect(await page.evaluate(() => { const node = document.querySelector('.timeline-panel'); let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))]; while (fiber && !fiber.memoizedProps?.store?.getState?.().timeline) fiber = fiber.return; return fiber?.memoizedProps.store.getState().selectedId; }) === 'shot-6', 'Preview activation keeps the selected footage');
  expect(!!await page.$('[data-testid="visual-handles"]'), 'Paused seek into selected footage shows transform handles');
  await page.mouse.click(selectedVisual.surface.x + .3 * selectedVisual.zoom, selectedVisual.surface.y + 8); await wait(80);
  expect(!await page.$('[data-testid="visual-handles"]'), 'Paused seek out of selected footage hides transform handles');
  expect(errors.length === 0, 'No browser runtime errors', errors);
  console.log(JSON.stringify({ baseUrl, cpuScale, passed: checks.every(check => check.passed), checks, measurements, errors }, null, 2));
  assert.ok(checks.every(check => check.passed), 'Custom playback/performance regression contains failing checks');
} finally { await browser.close(); }
