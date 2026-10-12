import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001';
const browser = await puppeteer.launch({ executablePath: '/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const page = await browser.newPage(), errors = [], checks = [];
const directory = await mkdtemp(join(tmpdir(), 'revline-workspace-ui-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, name, detail) => checks.push({ name, passed: !!condition, ...(detail === undefined ? {} : { detail }) });
page.on('pageerror', error => errors.push(error.message));
async function theme(value) {
  await page.evaluate(value => { localStorage.setItem('revline:workspace-theme', value); window.dispatchEvent(new Event('revline:theme-change')); }, value);
  await page.waitForFunction(value => document.documentElement.dataset.workspaceTheme === value, {}, value);
  await wait(100);
}
async function state() {
  return page.evaluate(() => {
    const element = document.querySelector('.timeline-scroll');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))], store;
    while (fiber) { if (fiber.memoizedProps?.store?.getState?.().timeline) store ??= fiber.memoizedProps.store; fiber = fiber.return; }
    if (!store) throw new Error('Existing editor provider not found');
    const rect = element.getBoundingClientRect(), value = store.getState();
    const tracks = [...element.querySelectorAll('.timeline-track')].map(track => { const bounds = track.getBoundingClientRect(); return { trackId: `${track.dataset.group}-${track.dataset.layer}`, y: bounds.y - rect.y, height: bounds.height }; });
    return { timeline: value.timeline, history: value.history.length, playhead: value.playhead, playing: value.playing, zoom: 54 * value.zoom, scroll: element.scrollLeft, surface: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, tracks };
  });
}
async function inspectorCheck(label) {
  const result = await page.evaluate(() => {
    const el = document.querySelector('.preview-inspector'), bounds = el.getBoundingClientRect(), input = el.querySelector('[aria-label="Search sources"]');
    const selected = el.querySelector('[role="tab"][aria-selected="true"]'), inputStyle = getComputedStyle(input), selectedStyle = getComputedStyle(selected), tokens = getComputedStyle(el);
    const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    return { width: bounds.width, inputBackground: inputStyle.backgroundColor, inputColor: inputStyle.color, tabColor: selectedStyle.color, expectedText: tokens.getPropertyValue('--ws-text').trim(), overflow: el.scrollWidth > el.clientWidth + 1, search: box(input), panel: box(el), tabs: [...el.querySelectorAll('[role="tab"]')].map(box) };
  });
  check(!result.overflow && result.tabs.every(tab => tab.left >= result.panel.left - 1 && tab.right <= result.panel.right + 1), `${label}: Sources tabs and cards fit the panel`, result);
  const expected = await page.evaluate(color => { const el = document.createElement('i'); el.style.color = color; document.body.append(el); const normalized = getComputedStyle(el).color; el.remove(); return normalized; }, result.expectedText);
  check(result.inputBackground === 'rgba(0, 0, 0, 0)' && result.inputColor === expected && result.tabColor === expected, `${label}: search and selected tab use the workspace theme`, result);
  return result;
}
async function conversationCheck(label) {
  const result = await page.evaluate(() => {
    const sidebar = document.querySelector('.editor-sidebar'), history = document.querySelector('.assistant-history'), composer = document.querySelector('.manual-composer-dock .edit-composer'), textarea = composer.querySelector('textarea');
    const bounds = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
    return { sidebar: bounds(sidebar), history: bounds(history), composer: bounds(composer), font: getComputedStyle(textarea).fontSize, senderWidths: [...history.querySelectorAll('.chat-user')].map(el => el.getBoundingClientRect().width), inlineVersions: document.querySelectorAll('.conversation-version').length, timeline: !!document.querySelector('.custom-timeline'), redundantEditorLink: !!document.querySelector('.workspace-editor-link'), viewportWidth: innerWidth, viewportHeight: innerHeight, pageWidth: document.documentElement.scrollWidth, previewRadius: getComputedStyle(document.querySelector('.preview-canvas')).borderTopLeftRadius };
  });
  check(result.timeline && !result.inlineVersions && !result.redundantEditorLink, `${label}: the conversation opens beside the full editor without an inline preview or redundant editor link`, result);
  check(result.font === '14px' && result.senderWidths.every(width => width <= 389), `${label}: the composer uses 14px text and sender messages fit their content`, result);
  check(result.composer.bottom <= result.viewportHeight + 1 && result.pageWidth <= result.viewportWidth, `${label}: the composer remains visible without horizontal overflow`, result);
  check(Math.abs(result.sidebar.right - result.history.right) <= 1 && result.composer.left - result.sidebar.left <= 21 && result.sidebar.right - result.composer.right <= 21, `${label}: the composer keeps small side gaps and leaves the scrollbar at the pane edge`, result);
  check(result.previewRadius === '0px', `${label}: the preview keeps square edges`, result.previewRadius);
}

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(new URL('/editor/demo', baseUrl).href, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready);
  await wait(800); await theme('light');
  await page.click('#inspector-sources-tab');
  const normal = await inspectorCheck('Desktop light');
  check(Math.abs(normal.width - 248) < 1, 'Desktop inspector defaults to 248px', normal.width);
  const handle = await page.$('[aria-label="Resize editing panel"]'), handleBox = await handle.boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await page.mouse.down(); await page.mouse.move(handleBox.x + 200, handleBox.y + handleBox.height / 2, { steps: 10 }); await page.mouse.up(); await wait(150);
  const minimum = await inspectorCheck('Desktop minimum');
  check(Math.abs(minimum.width - 220) < 1, 'Inspector resize respects the 220px minimum', minimum.width);
  await page.focus('#inspector-sources-tab'); await page.keyboard.press('ArrowRight');
  check(await page.$eval('#inspector-edit-tab', el => el.getAttribute('aria-selected') === 'true' && document.activeElement === el), 'Sources tab keyboard navigation activates and focuses Edit');
  await page.keyboard.press('End');
  check(await page.$eval('#inspector-effects-tab', el => el.getAttribute('aria-selected') === 'true' && document.activeElement === el), 'End key activates Effects');
  await page.keyboard.press('Home');
  check(await page.$eval('#inspector-sources', el => el.getAttribute('aria-labelledby') === 'inspector-sources-tab'), 'Sources panel is associated with its active tab');
  const image = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const context = canvas.getContext('2d'); context.fillStyle = '#c36b40'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#e7d8b2'; context.fillRect(100, 40, 120, 100); return canvas.toDataURL('image/png').split(',')[1]; });
  const imagePath = join(directory, 'workspace-source-test.png'), audioPath = join(directory, 'workspace-source-test.wav');
  await writeFile(imagePath, Buffer.from(image, 'base64'));
  const wav = Buffer.alloc(16044); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40); await writeFile(audioPath, wav);
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('[aria-label="Import footage"]')]); await chooser.accept([imagePath, audioPath]);
  await page.waitForSelector('.asset-card[title="Add workspace-source-test.wav to timeline"]'); await wait(300);
  check((await state()).timeline.clips.some(clip => clip.kind === 'audio'), 'Import footage decodes local image/audio and adds actual timeline clips');
  await page.select('[aria-label="Source type"]', 'audio');
  check(await page.$$eval('.footage-content-inspector .asset-card', cards => cards.length === 1 && cards[0].textContent.includes('workspace-source-test.wav')), 'Audio type filter shows only the imported audio');
  await page.select('[aria-label="Source type"]', 'video');
  check(await page.$eval('.source-no-results', el => el.textContent === 'No matching sources.'), 'Missing video results have a useful empty state');
  await page.select('[aria-label="Source type"]', 'image'); await page.type('[aria-label="Search sources"]', 'WORKSPACE-SOURCE');
  check(await page.$$eval('.footage-content-inspector .asset-card', cards => cards.length === 1 && cards[0].textContent.includes('workspace-source-test.png')), 'Image type and case-insensitive search compose');
  const beforeSeek = await state(); await page.mouse.click(beforeSeek.surface.x + 2.2 * beforeSeek.zoom, beforeSeek.surface.y + 8); await wait(100);
  const beforeClick = await state(); await page.click('.asset-card[title="Add workspace-source-test.png to timeline"]'); await wait(300); const afterClick = await state();
  check(afterClick.timeline.clips.length === beforeClick.timeline.clips.length + 1 && afterClick.history === beforeClick.history + 1 && Math.abs(afterClick.playhead - beforeClick.playhead) < 1 / 30, 'Clicking a source adds one undoable clip without moving the playhead');
  await page.click('[aria-label="Undo"]'); await wait(150); const undone = await state();
  check(undone.timeline.clips.length === beforeClick.timeline.clips.length && Math.abs(undone.playhead - beforeClick.playhead) < 1 / 30, 'Undoing a source insertion preserves the playhead');
  await page.click('[aria-label="Add timeline layer"]'); await page.waitForSelector('[role="menuitem"]');
  const item = await page.$$(' [role="menuitem"]');
  for (const candidate of item) if (await candidate.evaluate(el => el.textContent.includes('Video layer'))) { await candidate.click(); break; }
  await wait(150); const beforeDrag = await state(), empty = beforeDrag.tracks.find(track => track.trackId === 'visual-2');
  assert.ok(empty, `Video layer created for actual source drop: ${JSON.stringify(beforeDrag.tracks)}`);
  await page.setDragInterception(true);
  const source = await page.$('.asset-card[title="Add workspace-source-test.png to timeline"]'), sourceBox = await source.boundingBox();
  await page.mouse.dragAndDrop({ x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }, { x: beforeDrag.surface.x + 6 * beforeDrag.zoom - beforeDrag.scroll, y: beforeDrag.surface.y + empty.y + empty.height / 2 }, { delay: 100 });
  await page.setDragInterception(false); await wait(300); const dragged = await state();
  check(dragged.timeline.clips.length === beforeDrag.timeline.clips.length + 1 && dragged.history === beforeDrag.history + 1 && dragged.timeline.clips.some(clip => clip.track === 2 && Math.abs(clip.start - 6) < .05) && Math.abs(dragged.playhead - beforeDrag.playhead) < 1 / 30, 'Source drag drops into the requested layer/time and preserves the playhead', { before: beforeDrag.timeline.clips.length, after: dragged.timeline.clips.length, added: dragged.timeline.clips.filter(clip => !beforeDrag.timeline.clips.some(old => old.id === clip.id)) });
  await page.click('[aria-label="Undo"]'); await wait(100);
  check((await state()).timeline.clips.length === beforeDrag.timeline.clips.length && Math.abs((await state()).playhead - beforeDrag.playhead) < 1 / 30, 'Undoing the source drop preserves time and the preexisting empty layer');
  await theme('dark'); await inspectorCheck('Desktop dark');
  await page.setViewport({ width: 390, height: 844 }); await wait(250);
  if (!await page.$('.preview-inspector-sheet')) await page.click('[aria-label="Show editing panel"]');
  await page.waitForSelector('.preview-inspector-sheet'); await page.click('#inspector-sources-tab'); await inspectorCheck('Mobile dark');
  await theme('light'); await inspectorCheck('Mobile light');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile editing sheet does not widen the viewport');

  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(new URL('/chat/demo', baseUrl).href, { waitUntil: 'networkidle2' });
  check(new URL(page.url()).pathname === '/editor/demo', 'Legacy sample conversation link redirects to the full editor');
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready); await wait(1000);
  await theme('light'); await conversationCheck('Desktop light');
  const panels = await page.evaluate(() => { const sidebar = document.querySelector('.editor-sidebar').getBoundingClientRect(), workspace = document.querySelector('.editor-workspace').getBoundingClientRect(); return { sidebarRight: sidebar.right, workspaceLeft: workspace.left }; });
  check(panels.sidebarRight <= panels.workspaceLeft + 2, 'Desktop conversation stays to the left of preview and timeline', panels);
  await page.screenshot({ path: '/tmp/revline-editor-workspace-light.png' });
  await theme('dark'); await conversationCheck('Desktop dark');
  await page.click('[aria-label="Collapse timeline"]'); await wait(350);
  check(await page.$eval('.custom-timeline', el => Math.abs(el.getBoundingClientRect().height - 36) < 1), 'Collapsed timeline leaves only its 36px toolbar');
  await page.click('[aria-label="Expand timeline"]'); await wait(350);
  check(await page.$eval('.custom-timeline', el => el.getBoundingClientRect().height >= 160), 'Timeline expands back to a usable height');
  await page.setViewport({ width: 390, height: 844 }); await wait(250);
  await page.click('.mobile-panel-controls button'); await wait(100);
  await conversationCheck('Mobile dark'); await theme('light'); await conversationCheck('Mobile light');
  await page.setViewport({ width: 390, height: 500 }); await wait(250);
  await conversationCheck('Short mobile light');
  await page.screenshot({ path: '/tmp/revline-editor-workspace-mobile.png' });
  check(errors.length === 0, 'No browser runtime errors', errors);
  console.log(JSON.stringify({ baseUrl, passed: checks.every(value => value.passed), checks, errors }, null, 2));
  assert.ok(checks.every(value => value.passed), 'Workspace interaction smoke contains failing checks');
} finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
