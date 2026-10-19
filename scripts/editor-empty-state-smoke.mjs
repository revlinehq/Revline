import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const demoUrl = new URL(process.env.BASE_URL ?? 'http://localhost:3001/dev/editor');
assert.ok(['localhost', '127.0.0.1'].includes(demoUrl.hostname) && demoUrl.pathname === '/dev/editor', 'Run only the isolated local in-memory demo');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
try {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => ['GET', 'HEAD', 'OPTIONS'].includes(request.method()) ? request.continue() : request.abort());
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(demoUrl.href, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.timeline-scroll');
  await page.evaluate(() => {
    const timeline = document.querySelector('.timeline-scroll');
    let fiber = timeline[Object.keys(timeline).find(key => key.startsWith('__reactFiber$'))];
    while (fiber) {
      const store = fiber.memoizedProps?.store;
      if (store?.getState?.().timeline) { window.emptyStateStore = store; break; }
      fiber = fiber.return;
    }
    window.originalEditorNodes = { timeline, conversation: document.querySelector('.assistant-content'), composer: document.querySelector('.manual-composer-dock') };
    window.originalTimeline = window.emptyStateStore.getState().timeline;
    window.emptyStateStore.getState().edit({ ...window.originalTimeline, clips: [] });
  });
  await page.waitForSelector('.empty-upload');
  const empty = await page.evaluate(() => ({
    sameTimeline: window.originalEditorNodes.timeline === document.querySelector('.timeline-scroll'),
    sameConversation: window.originalEditorNodes.conversation === document.querySelector('.assistant-content'),
    sameComposer: window.originalEditorNodes.composer === document.querySelector('.manual-composer-dock'),
    uploadStage: !!document.querySelector('.project-import-stage'),
  }));
  assert.deepEqual(empty, { sameTimeline: true, sameConversation: true, sameComposer: true, uploadStage: false });
  await page.evaluate(() => window.emptyStateStore.getState().edit(window.originalTimeline));
  await page.waitForFunction(() => !document.querySelector('.empty-upload'));
  assert.equal(await page.evaluate(() => window.originalEditorNodes.timeline === document.querySelector('.timeline-scroll')), true);
  console.log('PASS: empty/rebuilt established editor keeps timeline, conversation and composer mounted.');
} finally {
  await browser.close();
}
