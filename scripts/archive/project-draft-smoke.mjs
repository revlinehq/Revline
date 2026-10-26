import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle = await build({ entryPoints: ['components/workspace/project-draft.ts'], bundle: true, format: 'iife', globalName: 'draft', write: false });
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(`<script>${bundle.outputFiles[0].text}</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(() => {
    window.puts = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      window.puts++;
      const request = put.apply(this, args);
      if (window.failNextPut) {
        window.failNextPut = false;
        queueMicrotask(() => this.transaction.abort());
      }
      return request;
    };
    window.a = new File(['a'], 'clip.mp4', { type: 'video/mp4', lastModified: 1 });
    window.b = new File(['b'], 'clip.mp4', { type: 'video/mp4', lastModified: 1 });
    window.c = new File(['c'], 'other.mp4', { type: 'video/mp4', lastModified: 1 });
    window.saved = async () => {
      const id = sessionStorage.getItem('revline:footage-draft');
      if (!id) return null;
      return new Promise((resolve, reject) => {
        const open = indexedDB.open('revline-drafts', 1);
        open.onsuccess = () => {
          const db = open.result, tx = db.transaction('footage'), request = tx.objectStore('footage').get(id);
          tx.oncomplete = () => { db.close(); resolve(request.result); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        open.onerror = () => reject(open.error);
      });
    };
    window.resetDraft = async () => { await draft.stashFiles([]); window.puts = 0; };
  });

  assert.equal(await page.evaluate(async () => {
    await Promise.all([draft.stashFiles([a]), draft.stashFiles([a])]);
    await draft.stashFiles([a]);
    await draft.takeFiles();
    await draft.stashFiles([a]);
    return puts;
  }), 1, 'Attaching, staging, and restoring identical File references must not rewrite their bytes');

  assert.deepEqual(await page.evaluate(async () => {
    await resetDraft();
    await Promise.all([draft.stashFiles([a]), draft.stashFiles([b]), draft.stashFiles([a])]);
    return { puts, text: await (await saved()).files[0].text() };
  }), { puts: 3, text: 'a' }, 'Changed content with identical filename/size retains queued selection order');

  assert.deepEqual(await page.evaluate(async () => {
    await resetDraft();
    await draft.stashFiles([a, c]);
    await draft.acknowledgeDraftFiles([a]);
    const afterAcknowledge = (await saved())?.files.length ?? 0;
    await draft.stashFiles([a, c]);
    await draft.stashFiles([]);
    const cleared = await saved();
    await draft.stashFiles([a, c]);
    return { afterAcknowledge, cleared, remaining: (await saved()).files.length };
  }), { afterAcknowledge: 1, cleared: null, remaining: 2 }, 'Acknowledgement and removal invalidate any reusable draft');

  assert.deepEqual(await page.evaluate(async () => {
    await resetDraft();
    failNextPut = true;
    await draft.stashFiles([a]);
    failNextPut = true;
    let refused = false;
    try { await draft.prepareExternalAuthRedirect(); } catch { refused = true; }
    await draft.prepareExternalAuthRedirect();
    return { puts, refused, text: await (await saved()).files[0].text() };
  }), { puts: 3, refused: true, text: 'a' }, 'Failed transactions retry and external auth requires durable footage');

  assert.deepEqual(await page.evaluate(async () => {
    await resetDraft();
    await draft.stashFiles([a]);
    const previous = (await saved()).expiresAt, now = Date.now;
    try {
      Date.now = () => now() + 60_000;
      await draft.prepareExternalAuthRedirect();
      const renewed = (await saved()).expiresAt > previous;
      Date.now = () => now() + 2 * 60 * 60_000;
      await draft.stashFiles([a]);
      return { puts, renewed, expiresInFuture: (await saved()).expiresAt > Date.now() };
    } finally { Date.now = now; }
  }), { puts: 3, renewed: true, expiresInFuture: true }, 'Auth refreshes expiry and expired drafts are rewritten');

  console.log('PASS: real IndexedDB writes coalesce identical drafts, preserve changed-selection order, retry failed transactions, and retain acknowledgement/removal/auth durability.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
