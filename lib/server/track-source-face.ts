import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import puppeteer from 'puppeteer';
import type { FocusSample } from '@/lib/editor/tracking';

export type SpeakerFaceAnchor={start:number;end:number;speaker:number;x:number;y:number};

/** Run the same MediaPipe face detector on the worker's Chromium decoder. */
export async function trackSourceFace(source: string, duration: number, onProgress: (percent: number) => void, signal: AbortSignal, anchors?:SpeakerFaceAnchor[]): Promise<FocusSample[]> {
  signal.throwIfAborted();
  const files = new Map<string, string>([
    ['/source.mp4', source],
    ['/vision.mjs', join(process.cwd(), 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')],
    ['/blaze-face.tflite', join(process.cwd(), 'public/vendor/blaze-face.tflite')],
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
    await page.exposeFunction('reportProgress', onProgress);
    await page.goto(`http://127.0.0.1:${address.port}/`);
    return await page.evaluate(async ({maxDuration,anchors}) => {
      const moduleUrl = `${location.origin}/vision.mjs`;
      const { FaceDetector, FilesetResolver } = await import(/* webpackIgnore: true */ moduleUrl);
      const vision = await FilesetResolver.forVisionTasks('/wasm');
      const detector = await FaceDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: '/blaze-face.tflite', delegate: 'CPU' }, runningMode: 'VIDEO', minDetectionConfidence: .55 });
      const video = document.createElement('video'); video.muted = true; video.preload = 'auto'; video.src = '/source.mp4'; document.body.appendChild(video);
      try {
        await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Tracking video loading timed out.')), 20_000); video.onloadeddata = () => { clearTimeout(timer); resolve(); }; video.onerror = () => { clearTimeout(timer); reject(new Error('The source video cannot be decoded.')); }; });
        const samples: FocusSample[] = []; let previous: { x: number; y: number } | undefined; let found = 0; let activeAnchor:number|undefined;
        const limit=anchors?maxDuration:Math.min(300,maxDuration),step=anchors?Math.max(.5,maxDuration/9000):.5;
        const times=[...new Set([...Array.from({length:Math.ceil(limit/step)},(_,i)=>i*step),...anchors?.map(a=>a.start)??[]])].sort((a,b)=>a-b);
        for (const time of times) {
          const anchor=anchors?.findLast(a=>a.start<=time&&a.end>time);
          if(anchors&&!anchor)continue;
          if(anchor&&activeAnchor!==anchor.start){previous={x:anchor.x,y:anchor.y};activeAnchor=anchor.start;}
          if (Math.abs(video.currentTime - time) > .01) await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Tracking video seeking timed out.')), 10_000); video.onseeked = () => { clearTimeout(timer); resolve(); }; video.currentTime = time; });
          const detections = detector.detectForVideo(video, Math.round(time * 1000)).detections as { boundingBox?: { originX: number; originY: number; width: number; height: number } }[];
          const faces = detections.flatMap(d => d.boundingBox ? [{ x: (d.boundingBox.originX + d.boundingBox.width / 2) / video.videoWidth, y: (d.boundingBox.originY + d.boundingBox.height / 2) / video.videoHeight, area: d.boundingBox.width * d.boundingBox.height }] : []);
          const last = previous;
          const face = faces.sort((a, b) => last ? Math.hypot(a.x - last.x, a.y - last.y) - Math.hypot(b.x - last.x, b.y - last.y) : b.area - a.area)[0];
          if (face&&(!anchors||!last||Math.hypot(face.x-last.x,face.y-last.y)<.2)) { found++; previous = { x: Math.min(1, Math.max(0, last ? last.x * .35 + face.x * .65 : face.x)), y: Math.min(1, Math.max(0, last ? last.y * .35 + face.y * .65 : face.y)) }; }
          if (previous) samples.push({ time, ...previous });
          await (window as unknown as { reportProgress: (percent: number) => Promise<void> }).reportProgress(Math.round(time / maxDuration * 100));
        }
        if (!found && !anchors) throw new Error('No clear face was found. Try a closer shot or reframe it by hand.');
        return samples;
      } finally { detector.close(); video.remove(); }
    }, {maxDuration:duration,anchors});
  } finally {
    signal.removeEventListener('abort', cancel);
    await browser?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
