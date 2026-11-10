import { ConvexError } from 'convex/values';
import { partLinkCache, type PartLink } from '../storage/part-links';

export type UploadedPart = { partNumber: number; etag: string };
/** A stored part with the media Worker's receipt, which lets an interrupted upload resume from it. */
export type StoredPart = UploadedPart & { receipt?: string };
/** `resuming`: continuing an interrupted upload. `waiting`: no part can reach storage right now. */
export type UploadActivity = 'uploading' | 'resuming' | 'waiting';

/** Parts in flight at the start; throughput decides how far it grows from here. */
const START_PARALLEL = 4;
/** Browsers open at most six HTTP/1.1 connections to a host; HTTP/2 and HTTP/3 multiplex. */
const HTTP1_PARALLEL = 6, MULTIPLEXED_PARALLEL = 12;
/** Save-Data or a slow connection keeps the upload light. */
const SLOW_PARALLEL = 2;
/** Throughput is judged over windows this long. A step up must add 8% to be kept; one that
 * adds 25% is followed by a doubling, so a fast line reaches its best within seconds. */
const SAMPLE_MS = 2500, WORTHWHILE_GAIN = 1.08, STRONG_GAIN = 1.25;
/** After a step up did not pay, or a part failed, hold before probing again. */
const HOLD_MS = 45_000, FAILURE_HOLD_MS = 30_000;
/** A request that moves no bytes for this long is dead; one still queued gets longer to start. */
const IDLE_MS = 90_000, CONNECT_MS = 5 * 60_000;
/** A part keeps retrying through an outage for this long before the upload stops. */
const GIVE_UP_MS = 15 * 60_000;

/** The upload stopped on a connection problem; its stored parts remain and it can continue later. */
export class UploadInterruptedError extends Error {}
/** A part request failed. `retry` tells whether sending it again can help. */
class PartFailure extends Error {
  constructor(message: string, readonly retry: 'again' | 'new-link' | 'never') { super(message); }
}

export function uploadPart(url: string, partNumber: number, blob: Blob, onProgress: (bytes: number) => void, signal?: AbortSignal): Promise<StoredPart> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const request = new XMLHttpRequest();
    const started = Date.now();
    let idle: ReturnType<typeof setTimeout> | undefined, stalled = false;
    const watch = (ms: number) => { clearTimeout(idle); idle = setTimeout(() => { stalled = true; request.abort(); }, ms); };
    const diagnostic = (reason: string) => console.warn('[upload] Part request failed', { reason, status: request.status, readyState: request.readyState, online: navigator.onLine, elapsedMs: Date.now() - started });
    const abort = () => request.abort();
    const cleanup = () => { clearTimeout(idle); signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    request.open('PUT', url); request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = event => { watch(IDLE_MS); onProgress(event.loaded); };
    request.onload = () => {
      cleanup();
      const status = request.status;
      if (status < 200 || status >= 300) {
        diagnostic('http');
        // 401 (media Worker) and 403 (storage): the signed link expired. 408, 429 and server errors pass; other refusals are final.
        reject(new PartFailure('Upload failed. Please try again.', status === 401 || status === 403 ? 'new-link' : status === 408 || status === 429 || status >= 500 ? 'again' : 'never'));
        return;
      }
      try {
        // Reading a header the server did not expose logs a browser error; look before asking.
        const headers = request.getAllResponseHeaders(), header = (name: string) => new RegExp(`^${name}:`, 'im').test(headers) ? request.getResponseHeader(name) : null;
        // The media Worker answers with JSON; storage itself answers with an empty body and the part's ETag header.
        const empty = !request.responseText.trim(), direct = empty ? header('etag')?.replace(/"/g, '') : null;
        // Sending the part again cannot help when storage took it but its ETag cannot be read.
        if (empty && !direct) { reject(new PartFailure('Cloud storage accepted this part but did not let the page read its confirmation. Please contact support.', 'never')); return; }
        const result = direct ? { partNumber, etag: direct } : JSON.parse(request.responseText) as UploadedPart;
        if (!result.etag || !Number.isInteger(result.partNumber)) throw new Error();
        const receipt = header('x-part-receipt');
        resolve({ partNumber: result.partNumber, etag: result.etag, ...(receipt ? { receipt } : {}) });
      } catch { reject(new PartFailure('Cloudflare did not confirm this upload part.', 'again')); }
    };
    request.onerror = () => { diagnostic('network'); fail(new PartFailure('Upload connection interrupted. Please try again.', 'again')); };
    request.onabort = () => { if (stalled) diagnostic('stalled'); fail(stalled ? new PartFailure('The upload connection timed out. Please try again.', 'again') : signal?.reason ?? new Error('Upload cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
    watch(CONNECT_MS);
    request.send(blob);
  });
}

type NetworkHints = { saveData?: boolean; effectiveType?: string };
/** Starts at four parts in flight and follows measured throughput: more while the total
 * keeps rising, back a step when it stops, and half as many after a failure. */
function createPace(onRaise: () => void) {
  const hints = (navigator as Navigator & { connection?: NetworkHints }).connection;
  const slow = !!hints?.saveData || /^(slow-2g|2g|3g)$/.test(hints?.effectiveType ?? '');
  let limit = slow ? SLOW_PARALLEL : START_PARALLEL, ceiling = slow ? START_PARALLEL : HTTP1_PARALLEL;
  let state: 'baseline' | 'probing' | 'holding' = 'baseline', baseline = 0, previous = limit, holdUntil = 0;
  // The first probe doubles; later re-probes after a hold add two.
  let windowStart = Date.now(), windowBytes = 0, first = true, capped = false;
  const restart = () => { windowStart = Date.now(); windowBytes = 0; };
  const raise = (strong: boolean) => {
    if (limit >= ceiling) { state = 'holding'; capped = true; holdUntil = Date.now() + HOLD_MS; return; }
    previous = limit; limit = Math.min(ceiling, strong ? limit * 2 : limit + 2); state = 'probing'; onRaise();
  };
  return {
    get limit() { return limit; },
    /** HTTP/2 and HTTP/3 carry every part on one connection, so more of them may run at once. */
    multiplexed() {
      if (slow) return;
      ceiling = MULTIPLEXED_PARALLEL;
      // A hold that began only because the HTTP/1.1 ceiling was reached ends here.
      if (capped && state === 'holding') { capped = false; state = 'baseline'; restart(); }
    },
    /** Count transferred bytes; `saturated` says every allowed part was in flight. */
    sent(bytes: number, saturated: boolean) {
      windowBytes += bytes;
      const now = Date.now(), elapsed = now - windowStart;
      if (elapsed < SAMPLE_MS) return;
      const rate = windowBytes / elapsed; restart();
      // A window that was short of parts says nothing about this limit.
      if (!saturated) return;
      if (state === 'baseline') { baseline = rate; raise(first); first = false; }
      else if (state === 'probing') {
        if (rate >= baseline * WORTHWHILE_GAIN) { const strong = rate >= baseline * STRONG_GAIN; baseline = rate; raise(strong); }
        else { limit = previous; state = 'holding'; holdUntil = now + HOLD_MS; }
      } else if (now >= holdUntil) state = 'baseline';
    },
    failed() { limit = Math.max(1, Math.ceil(limit / 2)); capped = false; state = 'holding'; holdUntil = Date.now() + FAILURE_HOLD_MS; restart(); },
  };
}

function delay(ms: number, signal: AbortSignal, wake?: 'online') {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (wake) window.removeEventListener(wake, done); if (error === undefined) resolve(); else reject(error); };
    const done = () => finish(), abort = () => finish(signal.reason ?? new Error('Upload cancelled.'));
    const timer = setTimeout(done, ms);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    if (wake) window.addEventListener(wake, done, { once: true });
  });
}

export type MultipartOptions = {
  /** Signed links for `count` consecutive parts starting at part `from`. */
  links: (from: number, count: number) => Promise<PartLink[]>;
  onProgress: (percent: number, activity: UploadActivity) => void;
  signal?: AbortSignal;
  /** Parts storage already holds from an interrupted upload; they are not sent again. */
  stored?: UploadedPart[];
  /** Called as each part is stored, so an interruption can resume after it. */
  onPart?: (part: StoredPart) => void;
};

export async function uploadMultipart(file: Blob, partSize: number, options: MultipartOptions): Promise<UploadedPart[]> {
  const { signal, onProgress } = options;
  if (!Number.isFinite(partSize) || partSize <= 0) throw new Error('Invalid upload part size.');
  signal?.throwIfAborted();
  const partCount = Math.ceil(file.size / partSize), parts: UploadedPart[] = new Array(partCount);
  const sizeOf = (index: number) => Math.min(partSize, file.size - index * partSize);
  const loaded = new Array<number>(partCount).fill(0), controller = new AbortController();
  let loadedBytes = 0;
  for (const part of options.stored ?? []) {
    const index = part.partNumber - 1;
    if (!Number.isInteger(index) || index < 0 || index >= partCount || parts[index]) continue;
    parts[index] = { partNumber: part.partNumber, etag: part.etag }; loaded[index] = sizeOf(index); loadedBytes += loaded[index];
  }
  const resumedBytes = loadedBytes, pending = Array.from({ length: partCount }, (_, index) => index).filter(index => !parts[index]);
  // A caller's cancellation stops every in-flight part with the caller's reason.
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const links = partLinkCache(options.links, partCount, partNumber => !parts[partNumber - 1]);
  const started = Date.now(); let lastLogged = started, lastPercent = -1, lastActivity: UploadActivity | undefined;
  let active = 0, waiting = 0, pump = () => {};
  const pace = createPace(() => pump());
  // Resource timing names the protocol of finished part requests when the server allows it.
  const observer = typeof PerformanceObserver === 'undefined' ? null : new PerformanceObserver(list => {
    if (list.getEntries().some(entry => /\/part\?/.test(entry.name) && /^h[23]/.test((entry as PerformanceResourceTiming).nextHopProtocol))) { pace.multiplexed(); observer?.disconnect(); }
  });
  try { observer?.observe({ type: 'resource' }); } catch { /* Parallelism stays at the HTTP/1.1 limit. */ }
  console.info(`[upload] ${new Date().toISOString()} Transfer started: ${(file.size / 1_000_000).toFixed(1)} MB, ${partCount} parts${resumedBytes ? `, resuming after ${partCount - pending.length} stored parts` : ''}, ${Math.min(pace.limit, pending.length)} parallel connections to begin.`);
  const announce = () => {
    const percent = Math.min(99, Math.round(loadedBytes / file.size * 100));
    if (controller.signal.aborted) return percent;
    const activity: UploadActivity = waiting > 0 && waiting >= active ? 'waiting' : resumedBytes ? 'resuming' : 'uploading';
    if (percent !== lastPercent || activity !== lastActivity) { lastPercent = percent; lastActivity = activity; onProgress(percent, activity); }
    return percent;
  };
  const report = (index: number, bytes: number) => {
    if (controller.signal.aborted) return;
    // Keep each part's high-water mark across retries; retransmitted bytes never
    // count twice or make the progress bar jump backwards.
    const amount = Math.max(loaded[index], Math.min(bytes, sizeOf(index))), gained = amount - loaded[index];
    loadedBytes += gained; loaded[index] = amount;
    pace.sent(gained, active >= pace.limit);
    const percent = announce(), now = Date.now();
    if (now - lastLogged >= 5000) { lastLogged = now; const seconds = Math.max((now - started) / 1000, .001), rate = (loadedBytes - resumedBytes) / seconds; console.info(`[upload] ${new Date(now).toISOString()} Transfer ${percent}%: ${(loadedBytes / 1_000_000).toFixed(1)}/${(file.size / 1_000_000).toFixed(1)} MB, ${(rate / 1_000_000).toFixed(2)} MB/s average, ${active} parallel, ${seconds.toFixed(1)}s elapsed${rate > 0 ? `, ~${Math.ceil((file.size - loadedBytes) / rate)}s remaining` : ''}.`); }
  };
  const pause = async (ms: number, wake?: 'online') => { waiting++; announce(); try { await delay(ms, controller.signal, wake); } finally { waiting--; announce(); } };
  const send = async (index: number) => {
    const partNumber = index + 1, blob = file.slice(index * partSize, index * partSize + sizeOf(index));
    // `outage` is time spent failing on this part; a sleeping laptop adds none.
    for (let attempt = 0, outage = 0, relinked = false; ; attempt++) {
      controller.signal.throwIfAborted();
      if (navigator.onLine === false) { await pause(30_000, 'online'); outage += 30_000; }
      const began = Date.now();
      try {
        const link = await links.get(partNumber);
        const uploaded = await uploadPart(link.url, partNumber, blob, bytes => report(index, bytes), controller.signal);
        if (uploaded.partNumber !== partNumber) throw new PartFailure('Cloudflare confirmed the wrong upload part.', 'never');
        parts[index] = { partNumber, etag: uploaded.etag }; report(index, blob.size); options.onPart?.(uploaded);
        return;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // The server refusing the lease (expired, cancelled) is final; so is a refused part.
        if (error instanceof ConvexError || error instanceof PartFailure && error.retry === 'never') throw error;
        links.drop(partNumber);
        // A new link is tried once for free. A second refusal is not about expiry; the stored parts stay for a later resume.
        const refused = error instanceof PartFailure && error.retry === 'new-link';
        if (refused && relinked) throw new UploadInterruptedError(`Cloud storage refused this upload. Add the file again to continue from ${announce()}%.`);
        const expired = refused; relinked ||= refused;
        if (!expired) pace.failed();
        const wait = expired ? 0 : Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) + Math.random() * 500;
        outage += Math.min(Date.now() - began, 60_000) + wait;
        if (outage > GIVE_UP_MS) throw new UploadInterruptedError(`The connection to cloud storage was lost for ${GIVE_UP_MS / 60_000} minutes. Add this file again to continue from ${announce()}%.`);
        console.warn(`[upload] ${new Date().toISOString()} Retrying part ${partNumber}/${partCount} in ${(wait / 1000).toFixed(1)}s.`);
        if (wait) await pause(wait);
      }
    }
  };
  try {
    announce();
    await new Promise<void>((resolve, reject) => {
      let failed = false;
      pump = () => {
        if (failed) return;
        if (!pending.length && !active) { resolve(); return; }
        while (active < pace.limit && pending.length) {
          active++;
          send(pending.shift()!).then(() => { active--; pump(); }, error => { active--; if (!failed) { failed = true; reject(error); } });
        }
      };
      pump();
    });
    // Parts between attempts exit quietly on abort; never return a partial upload.
    controller.signal.throwIfAborted();
  } catch (error) {
    // Stop sibling PUTs before the caller releases or keeps the multipart lease.
    controller.abort(error); throw error;
  } finally { signal?.removeEventListener('abort', forwardAbort); observer?.disconnect(); }
  const seconds = (Date.now() - started) / 1000;
  console.info(`[upload] ${new Date().toISOString()} Transfer complete in ${seconds.toFixed(1)}s (${((file.size - resumedBytes) / 1_000_000 / Math.max(seconds, .001)).toFixed(1)} MB/s).`);
  onProgress(100, resumedBytes ? 'resuming' : 'uploading'); return parts;
}
