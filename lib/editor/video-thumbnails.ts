// Small decoded stills are shared between clips, not a second playing video per tile.
const frames = new Map<string, string>();
type PendingFrame = { promise: Promise<string | null>; consumers: number; job?:SourceJob };
const pending = new Map<string, PendingFrame>();
type Request = { time: number; key: string; pendingKey:string; entry: PendingFrame; resolve: (image: string | null) => void };
type SourceJob = { url: string; urgent: Request[]; remaining: Request[]; current?:Request; controller:AbortController };
const sources = new Map<string, SourceJob>();
const jobs: (() => Promise<void>)[] = [];
let active = 0;
const keyFor = (url: string, time: number) => `${url}\n${time.toFixed(7)}`;

export function cachedVideoThumbnail(sourceId: string, time: number) {
  return frames.get(keyFor(sourceId, time));
}

/** A new split can retain a representative still while its exact source sample decodes. */
export function cachedNearestVideoThumbnail(sourceId: string, time: number, bounds: readonly [number, number] = [0, Infinity]): { time: number; image: string } | undefined {
  if (!Number.isFinite(time) || bounds[1] < bounds[0]) return undefined;
  const prefix = sourceId + '\n';
  let nearest: { key: string; time: number; image: string } | undefined;
  for (const [key, image] of frames) {
    if (!key.startsWith(prefix)) continue;
    const sample = Number(key.slice(prefix.length));
    if (!Number.isFinite(sample) || sample < bounds[0] || sample > bounds[1]) continue;
    if (!nearest || Math.abs(sample - time) < Math.abs(nearest.time - time) || (Math.abs(sample - time) === Math.abs(nearest.time - time) && sample < nearest.time)) nearest = { key, time: sample, image };
  }
  if (!nearest) return undefined;
  frames.delete(nearest.key); frames.set(nearest.key, nearest.image);
  return { time: nearest.time, image: nearest.image };
}

function drain() {
  while (active < 2 && jobs.length) {
    active++;
    void jobs.shift()!().finally(() => { active--; drain(); });
  }
}

function waitForMedia(video: HTMLVideoElement, event: 'loadeddata' | 'seeked', start: () => void,signal:AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener('error', failure);signal.removeEventListener('abort',abort); };
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error('Thumbnail decode failed')); };
    const abort=()=>{cleanup();reject(signal.reason??new DOMException('Thumbnail request cancelled.','AbortError'));};
    const timer = setTimeout(failure, 12_000);
    video.addEventListener(event, success, { once: true });
    video.addEventListener('error', failure, { once: true });
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted){abort();return;}
    try{start();}catch(error){cleanup();reject(error);}
  });
}

export function videoThumbnails(url: string, times: number[], sourceId = url, onFrame?: (time: number, image: string | null) => void, signal?: AbortSignal): Promise<(string | null)[]> {
  if (signal?.aborted) return Promise.resolve(times.map(() => null));
  let cancelled = false, released = false;
  const sourceKey=JSON.stringify([sourceId,url]);
  const consumers: PendingFrame[] = [];
  const release = () => {
    if (released) return; released = true;
    for (const entry of consumers) entry.consumers--;
    // React can replace clip subscribers in one commit. Let their new effects
    // attach before releasing a decoder that still has useful queued samples.
    for(const job of new Set(consumers.map(entry=>entry.job)))if(job)queueMicrotask(()=>{if(![job.current,...job.urgent,...job.remaining].some(request=>request&&request.entry.consumers>0))job.controller.abort();});
  };
  let resolveCancelled!: (images:(string|null)[])=>void;
  const cancelledResult=new Promise<(string|null)[]>(resolve=>{resolveCancelled=resolve;});
  const abort = () => { cancelled = true; release();resolveCancelled(times.map(()=>null)); };
  const missing: Request[] = [];
  const results = times.map(time => {
    const key = keyFor(sourceId, time);
    const pendingKey=keyFor(sourceKey,time);
    const cached = frames.get(key);
    if (cached) { frames.delete(key); frames.set(key, cached); return Promise.resolve(cached); }
    const existing = pending.get(pendingKey);
    if (existing&&!existing.job?.controller.signal.aborted&&existing.consumers>0) {
      existing.consumers++; consumers.push(existing);
      if (time === times[0]) {
        const source = sources.get(sourceKey), index = source?.remaining.findIndex(request => request.pendingKey === pendingKey) ?? -1;
        if (source && index >= 0) source.urgent.push(...source.remaining.splice(index, 1));
      }
      return existing.promise;
    }
    let resolve!: (image: string | null) => void;
    const promise = new Promise<string | null>(done => { resolve = done; });
    const entry:PendingFrame = { promise, consumers: 1 }; consumers.push(entry);
    pending.set(pendingKey, entry); missing.push({ time, key, pendingKey,entry, resolve });
    return promise;
  });
  if (missing.length) {
    let source = sources.get(sourceKey);
    if(source?.controller.signal.aborted)source=undefined;
    const enqueue = !source;
    if (!source) { source = { url, urgent: [], remaining: [],controller:new AbortController() }; sources.set(sourceKey, source); }
    for(const request of missing)request.entry.job=source;
    // Each visible clip gets its first still before any clip fills its entire strip.
    source.urgent.push(missing[0]); source.remaining.push(...missing.slice(1));
    if (enqueue) {
      const job = source;
      jobs.push(async () => {
        const finish = (request: Request, image: string | null) => {
          if (image) { frames.set(request.key, image); while (frames.size > 512) frames.delete(frames.keys().next().value!); }
          if(pending.get(request.pendingKey)===request.entry)pending.delete(request.pendingKey); request.resolve(image);
        };
        if(job.controller.signal.aborted){for(const request of [...job.urgent,...job.remaining])finish(request,null);if(sources.get(sourceKey)===job)sources.delete(sourceKey);return;}
        const video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
        let current: Request | undefined;
        try {
          await waitForMedia(video, 'loadeddata', () => { video.src = job.url; video.load(); },job.controller.signal);
          if (!video.videoWidth || !video.videoHeight) throw new Error('Video dimensions unavailable');
          const canvas = document.createElement('canvas');
          const scale = Math.min(96 / video.videoHeight, 320 / video.videoWidth);
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Thumbnail canvas unavailable');
          while ((current = job.urgent.shift() ?? job.remaining.shift())) {
            job.current=current;
            if (!current.entry.consumers) { finish(current, null); current = undefined; continue; }
            const time = Math.max(0, Math.min(current.time, Math.max(0, video.duration - 1 / 60)));
            if (Math.abs(video.currentTime - time) > .001) await waitForMedia(video, 'seeked', () => { video.currentTime = time; },job.controller.signal);
            job.controller.signal.throwIfAborted();
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            finish(current, canvas.toDataURL('image/jpeg', .75)); current = undefined;job.current=undefined;
          }
        } catch {
          if (current) finish(current, null);
          for (const request of [...job.urgent, ...job.remaining]) finish(request, null);
        } finally {
          if(sources.get(sourceKey)===job)sources.delete(sourceKey); video.removeAttribute('src'); video.load();
        }
      });
      drain();
    }
  }
  signal?.addEventListener('abort', abort, { once: true });
  if(signal?.aborted)abort();
  return Promise.race([Promise.all(results.map((result, index) => result.then(image => { if (cancelled) return null; onFrame?.(times[index], image); return image; }))),cancelledResult]).finally(() => { release(); signal?.removeEventListener('abort', abort); });
}
