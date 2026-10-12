// Small decoded stills are shared between clips, not a second playing video per tile.
const frames = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
const jobs: (() => Promise<void>)[] = [];
let active = 0;
const keyFor = (url: string, time: number) => `${url}\n${time.toFixed(7)}`;

export function cachedVideoThumbnail(sourceId: string, time: number) {
  return frames.get(keyFor(sourceId, time));
}

function drain() {
  while (active < 2 && jobs.length) {
    active++;
    void jobs.shift()!().finally(() => { active--; drain(); });
  }
}

function waitForMedia(video: HTMLVideoElement, event: 'loadeddata' | 'seeked', start: () => void) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener('error', failure); };
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error('Thumbnail decode failed')); };
    const timer = setTimeout(failure, 12_000);
    video.addEventListener(event, success, { once: true });
    video.addEventListener('error', failure, { once: true });
    start();
  });
}

export function videoThumbnails(url: string, times: number[], sourceId = url, onFrame?: (time: number, image: string | null) => void): Promise<(string | null)[]> {
  const missing: { time: number; key: string; resolve: (image: string | null) => void }[] = [];
  const results = times.map(time => {
    const key = keyFor(sourceId, time);
    const cached = frames.get(key);
    if (cached) { frames.delete(key); frames.set(key, cached); return Promise.resolve(cached); }
    const existing = pending.get(key);
    if (existing) return existing;
    let resolve!: (image: string | null) => void;
    const promise = new Promise<string | null>(done => { resolve = done; });
    pending.set(key, promise); missing.push({ time, key, resolve });
    return promise;
  });
  if (missing.length) {
    jobs.push(async () => {
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
      const finish = (request: typeof missing[number], image: string | null) => {
        if (image) { frames.set(request.key, image); while (frames.size > 512) frames.delete(frames.keys().next().value!); }
        pending.delete(request.key); request.resolve(image);
      };
      let completed = 0;
      try {
        await waitForMedia(video, 'loadeddata', () => { video.src = url; video.load(); });
        if (!video.videoWidth || !video.videoHeight) throw new Error('Video dimensions unavailable');
        const canvas = document.createElement('canvas');
        const scale = Math.min(96 / video.videoHeight, 320 / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Thumbnail canvas unavailable');
        for (const request of missing) {
          const time = Math.max(0, Math.min(request.time, Math.max(0, video.duration - 1 / 60)));
          if (Math.abs(video.currentTime - time) > .001) await waitForMedia(video, 'seeked', () => { video.currentTime = time; });
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(request, canvas.toDataURL('image/jpeg', .75)); completed++;
        }
      } catch {
        for (const request of missing.slice(completed)) finish(request, null);
      } finally {
        video.removeAttribute('src'); video.load();
      }
    });
    drain();
  }
  return Promise.all(results.map((result, index) => result.then(image => { onFrame?.(times[index], image); return image; })));
}
