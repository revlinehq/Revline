import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const page = await browser.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
try {
 await page.setViewport({ width: 1440, height: 900 });
 await page.goto(`${process.env.BASE_URL ?? 'http://localhost:3001'}/dev/editor`, { waitUntil: 'networkidle2' });
 await page.waitForSelector('.timeline-panel');
 await page.evaluate(() => {
  const el = document.querySelector('.timeline-panel'); let fiber = el[Object.keys(el).find(k => k.startsWith('__reactFiber$'))];
  while (fiber && !fiber.memoizedProps?.store?.getState?.().timeline) fiber = fiber.return;
  const store = fiber.memoizedProps.store; store.getState().replace({ ...store.getState().timeline, clips: [] });
 });
 await page.waitForSelector('.project-import-stage');
 for (const theme of ['light', 'dark']) {
  await page.evaluate(theme => { localStorage.setItem('revline:workspace-theme', theme); window.dispatchEvent(new Event('revline:theme-change')); }, theme);
  await page.waitForFunction(theme => document.documentElement.dataset.workspaceTheme === theme, {}, theme);
  const colors = await page.evaluate(() => {
   const color = selector => { const el = document.querySelector(selector), s = getComputedStyle(el); return { background: s.backgroundColor, color: s.color }; };
   return { stage: color('.project-import-stage'), card: color('.import-drop-card'), title: color('.import-heading h1'), subtitle: color('.import-heading p'), icon: color('.import-drop-icon'), header: color('.workspace-nav') };
  });
  const expectedBg = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(16, 16, 16)';
  const passed = colors.stage.background === expectedBg && colors.stage.background === colors.header.background && colors.title.color === (theme === 'light' ? 'rgb(41, 41, 41)' : 'rgb(242, 242, 242)');
  checks.push({ theme, passed, colors });
  await page.screenshot({ path: `/tmp/revline-project-import-${theme}.png` });
 }
 console.log(JSON.stringify({ checks, errors }, null, 2));
 assert.ok(checks.every(c => c.passed), 'Project import must follow workspace light/dark theme');
 assert.equal(errors.length, 0, 'No browser runtime errors');
} finally { await browser.close(); }
