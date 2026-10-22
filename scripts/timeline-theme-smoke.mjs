import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001';
const browser = await puppeteer.launch({ executablePath: '/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const page = await browser.newPage(), checks = [], errors = [], samples = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, name, detail) => checks.push({ name, passed: !!condition, ...(detail === undefined ? {} : { detail }) });
page.on('pageerror', error => errors.push(error.message));

async function inspect() {
  return page.evaluate(() => {
    const panel = document.querySelector('.custom-timeline');
    const surface = node => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return { background: style.backgroundColor, color: style.color, border: style.borderBottomColor, borderStyle: style.borderBottomStyle, borderWidth: style.borderBottomWidth, x: rect.x, top: rect.top, bottom: rect.bottom, right: rect.right, width: rect.width };
    };
    const probe = document.createElement('span'); probe.style.cssText = 'position:absolute;width:0;height:0;background:var(--ws-bg);color:var(--ws-muted);border-bottom:1px solid var(--ws-artifact-border)'; panel.appendChild(probe);
    const expected = surface(probe); probe.style.borderBottomColor = 'var(--timeline-divider)'; expected.divider = surface(probe).border; probe.remove();
    const viewport = document.querySelector('.timeline-scroll');
    const cap = document.querySelector('.timeline-playhead-cap'), capBox = surface(cap);
    const capHit = x => document.elementFromPoint(x, capBox.top + 5)?.closest('.timeline-playhead-cap') === cap;
    return { theme: document.documentElement.dataset.workspaceTheme, expected, panel: surface(panel), rail: surface(document.querySelector('.track-headers')), viewport: surface(viewport), scroll: viewport.scrollLeft, ruler: surface(document.querySelector('.time-ruler')), rulerHeader: surface(document.querySelector('.track-ruler-label')), marker: { cap: capBox, line: surface(document.querySelector('.playhead')), firstClip: surface(document.querySelector('.clip-video')), height: cap.getBoundingClientRect().height, visible: getComputedStyle(cap).visibility, cornersVisible: capHit(capBox.x + 2) && capHit(capBox.right - 2) }, pairs: [...document.querySelectorAll('.timeline-track[data-group][data-layer]')].map(row => ({ id: `${row.dataset.group}-${row.dataset.layer}`, row: surface(row), header: surface(document.querySelector(`.track-label[data-group="${row.dataset.group}"][data-layer="${row.dataset.layer}"]`)) })) };
  });
}

function verify(value, label) {
  const blocks = [value.panel, value.rail, value.ruler, value.rulerHeader, ...value.pairs.flatMap(pair => [pair.row, pair.header])];
  check(blocks.every(block => block.background === value.expected.background), `${label}: headers, lanes and ruler share the workspace surface`, blocks.map(block => block.background));
  const borders = [value.ruler, value.rulerHeader, ...value.pairs.flatMap(pair => [pair.row, pair.header])];
  check(borders.every(block => block.color === value.expected.color), `${label}: timeline labels use the theme text color`, borders.map(block => block.color));
  // The ruler keeps the artifact border; track rows and their names share the softer --timeline-divider token
  // (both defined in custom-timeline.css since 84725d4).
  const rows = value.pairs.flatMap(pair => [pair.row, pair.header]);
  check([value.ruler, value.rulerHeader].every(block => block.border === value.expected.border && block.borderStyle === 'solid' && block.borderWidth === '1px') && rows.every(block => block.border === value.expected.divider && block.borderStyle === 'solid' && block.borderWidth === '1px'), `${label}: ruler and track dividers use their visible theme borders consistently`, borders.map(block => ({ border: block.border, width: block.borderWidth })));
  check(value.pairs.every(pair => Math.abs(pair.row.top - pair.header.top) < .6 && Math.abs(pair.row.bottom - pair.header.bottom) < .6) && Math.abs(value.ruler.bottom - value.rulerHeader.bottom) < .6, `${label}: horizontal dividers align between names and lanes`);
  check(value.pairs.every(pair => pair.header.right >= value.viewport.x - 1.1 && pair.row.x <= value.viewport.x + .6 && pair.row.right >= value.viewport.right - .6) && value.ruler.right >= value.viewport.right - .6, `${label}: dividers reach the visible timeline wall and right edge`);
}

try {
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto(new URL('/dev/editor', baseUrl).href, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.custom-timeline');
    await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready);
    // Phones open on the conversation (57c304e); the timeline lives in Tracks.
    if (width === 390) { await page.click('#editor-tracks-tab'); await page.waitForFunction(() => document.querySelector('.track-headers').getBoundingClientRect().x >= 0 && document.querySelector('.track-headers').getBoundingClientRect().x < innerWidth); }
    if (width === 390) await page.waitForFunction(() => document.querySelector('.editor-workspace').getBoundingClientRect().width >= innerWidth - 1);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { localStorage.setItem('revline:workspace-theme', theme); window.dispatchEvent(new Event('revline:theme-change')); }, theme);
      await page.waitForFunction(theme => document.documentElement.dataset.workspaceTheme === theme, {}, theme);
      await page.evaluate(() => document.fonts.ready); await wait(100);
      await page.$eval('.timeline-scroll', node => node.scrollLeft = 0); await wait(80);
      const zero = await page.$eval('.time-ruler', node => { const r = node.getBoundingClientRect(); return { x: r.x + 1, y: r.y + 6 }; });
      await page.mouse.click(zero.x, zero.y); await wait(80);
      const initial = await inspect(); verify(initial, `${width}px ${theme}`); samples.push(initial);
      check(initial.marker.height === 20 && // 29c5837 restored the 14x20 pointed playhead cap
         initial.marker.visible === 'visible' && initial.marker.cornersVisible && Math.abs(initial.marker.firstClip.x - initial.viewport.x) < .6 && Math.abs(initial.marker.cap.x + initial.marker.cap.width / 2 - initial.marker.line.x - initial.marker.line.width / 2) < .6, `${width}px ${theme}: containment preserves the full zero-time marker and flush clip origin`);
      for (let index = 0; index < 3; index++) await page.click('[aria-label="Zoom in"]');
      await page.$eval('.timeline-scroll', node => node.scrollLeft = Math.min(180, node.scrollWidth - node.clientWidth)); await wait(100);
      const panned = await inspect(); verify(panned, `${width}px ${theme} panned`);
      check(Math.abs(initial.rail.x - panned.rail.x) < .6 && panned.scroll > 0, `${width}px ${theme}: scrolling preserves pinned headers`);
      check(panned.rail.x >= -.6 && panned.panel.x >= -.6 && panned.panel.right <= width + .6, `${width}px ${theme}: focused toolbar controls cannot pan the whole timeline offscreen`);
      const reachable = await page.evaluate(() => {
        const toolbar = document.querySelector('.timeline-toolbar');
        const targetVisible = selector => { const target = toolbar.querySelector(selector), rect = target.getBoundingClientRect(), box = toolbar.getBoundingClientRect(); return rect.x >= box.x - .6 && rect.right <= box.right + .6; };
        // Each toolbar group scrolls on its own (overflow-x:auto on .timeline-view-actions); scroll the group that owns the control.
        const scroller = selector => { let node = toolbar.querySelector(selector).parentElement; while (node !== toolbar && node.scrollWidth <= node.clientWidth) node = node.parentElement; return node; };
        const showStart = selector => { toolbar.scrollLeft = 0; const owner = scroller(selector); owner.scrollLeft = 0; return targetVisible(selector); };
        const showEnd = selector => { toolbar.scrollLeft = toolbar.scrollWidth; const owner = scroller(selector); owner.scrollLeft = owner.scrollWidth; return targetVisible(selector); };
        const first = showStart('[aria-label="Unlink video and audio"]');
        const last = showEnd('[aria-label="Collapse timeline"]');
        toolbar.querySelectorAll('*').forEach(node => { if (node.scrollLeft) node.scrollLeft = 0; });
        let node = toolbar.parentElement, ancestorPan = false; while (node) { ancestorPan ||= node.scrollLeft !== 0; node = node.parentElement; }
        return { first, last, ancestorPan, overflow: toolbar.scrollWidth > toolbar.clientWidth, toolbarPan: toolbar.scrollLeft };
      });
      check(reachable.first && reachable.last && !reachable.ancestorPan, `${width}px ${theme}: overflowed toolbar controls remain reachable without moving the lanes`, reachable);
      // Overlay rows merged into shared V tracks: graphics are on V2 and captions on V3.
      const header = await page.$eval('.track-label[data-group="visual"][data-layer="2"] .track-label-name', node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      const target = await page.$eval('.track-label[data-group="visual"][data-layer="3"]', node => { const r = node.getBoundingClientRect(); return { y: r.y + r.height / 2 }; });
      await page.mouse.move(header.x, header.y); await page.mouse.down(); await page.mouse.move(header.x, target.y, { steps: 8 }); await wait(80);
      await page.waitForSelector('.track-label.layer-drop-target', { timeout: 2000 }).catch(error => { console.error(`${width}px ${theme}: header reorder did not start from ${JSON.stringify(header)} to ${JSON.stringify(target)}`); throw error; });
      const destination = await page.$eval('.track-label.layer-drop-target', (node, base) => {
        const style = getComputedStyle(node);
        const channels = color => { const values = color.match(/[\d.]+/g).map(Number), srgb = color.startsWith('color(srgb'); return { rgb: values.slice(0, 3).map(value => srgb ? value : value / 255), alpha: values[3] ?? 1 }; };
        // Composite translucent tints over the workspace surface before measuring contrast.
        const over = (color, under) => { const top = channels(color), bottom = channels(under).rgb; return top.rgb.map((value, index) => value * top.alpha + bottom[index] * (1 - top.alpha)); };
        const luminance = rgb => rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const surfaceRgb = over(style.backgroundColor, base);
        const text = luminance(over(style.color, `rgb(${surfaceRgb.map(value => value * 255).join(',')})`)), background = luminance(surfaceRgb);
        return { background: style.backgroundColor, shadow: style.boxShadow, contrast: (Math.max(text, background) + .05) / (Math.min(text, background) + .05) };
      }, initial.expected.background);
      // Dark main-editor timelines use a muted blue line pair (custom-timeline.css dark override since 84725d4).
      const lineColor = theme === 'dark' ? 'rgb(82, 107, 148)' : 'rgb(0, 157, 255)';
      check(destination.background !== initial.expected.background && destination.shadow.includes(lineColor), `${width}px ${theme}: reorder destination has a distinct tint and blue placement lines`, destination);
      check(destination.contrast >= 3, `${width}px ${theme}: reorder destination keeps its label readable`, destination.contrast);
      await page.keyboard.press('Escape'); await page.mouse.up(); await wait(100);
      await page.click('[aria-label="Collapse timeline"]'); await wait(100);
      const collapsed = await page.$eval('.timeline-panel', node => ({ height: node.getBoundingClientRect().height, wrapper: node.parentElement.getBoundingClientRect().height, toolbar: node.querySelector('.timeline-toolbar').getBoundingClientRect().height, markerHidden: document.querySelector('.timeline-playhead-cap').getClientRects().length === 0 }));
      // The collapsed panel fits its measured toolbar, which wraps onto extra rows on phones (a7bc215).
      check(collapsed.height - collapsed.toolbar > -.6 && collapsed.height - collapsed.toolbar < 1.1 && Math.abs(collapsed.wrapper - collapsed.height) < .6 && // collapsedSize rounds the toolbar up to whole pixels
         (width !== 1440 || Math.abs(collapsed.toolbar - 36) < .6) && collapsed.markerHidden, `${width}px ${theme}: collapse keeps exactly the toolbar (36px on desktop) without an empty wrapper gap`, collapsed);
      await page.click('[aria-label="Expand timeline"]'); await wait(100);
      await page.$eval('.timeline-scroll', node => node.scrollLeft = 0); await wait(80);
      await page.evaluate(() => document.activeElement?.blur());
      if (width === 1440) await (await page.$('.timeline-panel')).screenshot({ path: `/tmp/revline-custom-timeline-${theme}.png` });
      console.error(`${width}px ${theme}: ${checks.filter(value => !value.passed).length} failures so far`);
    }
  }
  check(errors.length === 0, 'No browser runtime errors', errors);
  console.log(JSON.stringify({ baseUrl, passed: checks.every(value => value.passed), checks, samples, errors }, null, 2));
  assert.ok(checks.every(value => value.passed), 'Custom timeline theme regression contains failing checks');
} finally { await browser.close(); }
