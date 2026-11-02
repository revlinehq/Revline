import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import puppeteer from 'puppeteer';
import type { Page } from 'puppeteer';


export async function withSourceFaceDecoder<T>(source: string, signal: AbortSignal, work: (page: Page) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const files = new Map<string, string>([
    ['/source.mp4', source],
    ['/vision.mjs', join(process.cwd(), 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')],
    ['/blaze-face.tflite', join(process.cwd(), 'public/vendor/blaze-face.tflite')],
    ['/face-landmarker.task', join(process.cwd(), 'public/vendor/face-landmarker.task')],
  ]);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><body></body>'); return; }
      const path = files.get(url) ?? (/^\/wasm\/vision_wasm_[a-z_]+\.(wasm|js)$/.test(url) ? join(process.cwd(), 'public/vendor/mediapipe', basename(url)) : null);
      if (!path) { response.writeHead(404).end(); return; }
      const { size } = await stat(path);
      response.setHeader('Content-Type', url.endsWith('.mjs') || url.endsWith('.js') ? 'text/javascript' : url.endsWith('.wasm') ? 'application/wasm' : url.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');
      response.setHeader('Accept-Ranges', 'bytes');
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (start > end || end >= size) { response.writeHead(416).end(); return; }
      if (range) { response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`); }
      response.setHeader('Content-Length', end - start + 1);
      const stream = createReadStream(path, { start, end });
      response.on('close', () => stream.destroy()); stream.on('error', () => response.destroy()); stream.pipe(response);
    } catch { response.writeHead(500).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start the tracking decoder.');
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  const cancel = () => { void browser?.close(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    signal.throwIfAborted();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    return await work(page);
  } finally {
    signal.removeEventListener('abort', cancel);
    await browser?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
