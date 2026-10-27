import type { MediaAsset } from './types';

/** Originals above this wait for a preview derivative; derivatives up to it download first. */
export const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
// A derivative streamed by byte range stalls at every cold cut: each cut's element
// fetches its own source position on first play. A few minutes of 720p60 footage
// is ~100 MB, so derivatives up to this size are downloaded whole into memory too.
const MAX_LOCAL_COPY_BYTES = 192 * 1024 * 1024;
const MAX_SESSION_BYTES = 384 * 1024 * 1024;
type PreviewAsset = MediaAsset & { previewUrl?: string | null; previewVersion?: string | number | null; previewSize?: number | null };
// Stopping a download on close is expected. Chrome (notably with DevTools inspecting the
// response) can still report its own copy of the abort as unhandled, so the cache's own
// reasons, matched by object or by their distinctive message, are silenced in capture phase.
const ownAborts = new WeakSet<object>();
const ownMessages = new Set<string>();
const ownAbort = (message: string, name = 'AbortError') => { const reason = new DOMException(message, name); ownAborts.add(reason); ownMessages.add(message); return reason; };
if (typeof window !== 'undefined') window.addEventListener('unhandledrejection', event => {
  const reason = event.reason;
  if (reason && typeof reason === 'object' && (ownAborts.has(reason) || (reason as { name?: unknown }).name === 'AbortError' && ownMessages.has(String((reason as { message?: unknown }).message)))) { event.preventDefault(); event.stopImmediatePropagation(); }
}, { capture: true });
type Entry = { controller: AbortController; consumers: Set<symbol>; promise: Promise<string>; expectedBytes: number; url?: string };

/** One bounded, immutable preview download shared by every cut of an asset. */
export function createPreviewSourceCache() {
  const entries = new Map<string, Entry>();
  const failures = new Map<string, { url: string; retryAt: number }>();
  let disposed = false;
  // Video plays its preview derivative; audio (each cut's linked sound and music) plays its own
  // file. Both are copied whole: a byte-range stream makes every cut seek over the network.
  const source = (asset: PreviewAsset): { url: string; size?: number | null; type: string } | null =>
    asset.kind === 'video' && asset.previewUrl ? { url: asset.previewUrl, size: asset.previewSize, type: 'video/mp4' }
      : asset.kind === 'audio' && asset.url ? { url: asset.url, size: asset.size, type: 'audio/mp4' } : null;
  const keyFor = (asset: PreviewAsset) => `${asset._id}|${asset.previewVersion ?? ''}|${source(asset)?.size ?? ''}`;
  const playable = (asset: PreviewAsset, url: string): MediaAsset => asset.url === url ? asset : { ...asset, url };
  const preview = (asset: PreviewAsset) => source(asset)?.url ?? null;
  const abortReason = (signal: AbortSignal) => signal.reason ?? ownAbort('Preview replaced.');
  function nativeAsset(asset: PreviewAsset) {
    const url = preview(asset);
    return url ? playable(asset, entries.get(keyFor(asset))?.url ?? url) : asset;
  }
  function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener('abort', abort);
      const abort = () => { cleanup(); reject(abortReason(signal)); };
      signal.addEventListener('abort', abort, { once: true });
      pending.then(value => { cleanup(); resolve(value); }, cause => { cleanup(); reject(cause); });
      if (signal.aborted) abort();
    });
  }
  async function download(asset: PreviewAsset, controller: AbortController) {
    const { signal } = controller, file = source(asset)!;
    let idle: ReturnType<typeof setTimeout>, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const progress = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(ownAbort('Preview preparation stalled.', 'TimeoutError')), 30_000); };
    // The request itself is never aborted. Chrome reports an aborted fetch's internal
    // promises as unhandled rejections carrying our reason (seen in a real window, notably
    // with DevTools or an embedded preview inspecting it), which the dev overlay shows as
    // "AbortError: Preview closed.". Stopping instead stops waiting and cancels the body:
    // the stream once it is being read, or the response as soon as it arrives.
    let cancelling: Promise<boolean> | undefined;
    const cancel = () => (cancelling ??= (async () => { await reader!.cancel(); return true; })().catch(() => true));
    const stop = () => { if (reader) void cancel(); };
    signal.addEventListener('abort', stop, { once: true });
    progress();
    try {
      const pending = fetch(file.url);
      signal.addEventListener('abort', () => { void pending.then(late => { if (!late.bodyUsed && !late.body?.locked) return late.body?.cancel(); }).catch(() => {}); }, { once: true });
      const response = await abortable(pending, signal);
      if (!response.ok) throw new Error('Preview download failed.');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_LOCAL_COPY_BYTES) throw new Error('Preview exceeds the local playback limit.');
      if (response.status === 206) {
        const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
        if (!range || Number(range[1]) + 1 !== Number(range[2])) throw new Error('Preview download was incomplete.');
      }
      reader = response.body?.getReader();
      if (!reader) throw new Error('Preview download has no readable body.');
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await abortable(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > MAX_LOCAL_COPY_BYTES) throw new Error('Preview exceeds the local playback limit.');
        if (value.byteLength) progress(); // Headers and empty chunks are not byte progress.
        chunks.push(new Uint8Array(value));
      }
      signal.throwIfAborted();
      if (!size || size !== file.size) throw new Error('Preview download was incomplete.');
      return URL.createObjectURL(new Blob(chunks, { type: response.headers.get('content-type') || file.type }));
    } catch (cause) {
      controller.abort(ownAbort('Preview download stopped.'));
      if (reader) {
        // A broken stream's cancel promise must not keep fallback playback stuck.
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([cancel(), new Promise<boolean>(resolve => { cleanupTimer = setTimeout(() => resolve(false), 1000); })]);
        if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
      }
      throw cause;
    } finally {
      clearTimeout(idle!);
      signal.removeEventListener('abort', stop);
      try { reader?.releaseLock(); } catch { /* The aborted fetch releases a pending read. */ }
    }
  }
  function entryFor(asset: PreviewAsset) {
    const key = keyFor(asset);
    const failed = failures.get(key);
    if (failed && failed.url === preview(asset) && Date.now() < failed.retryAt) return undefined;
    if (failed) failures.delete(key);
    let entry = entries.get(key);
    if (entry?.controller.signal.aborted) { entries.delete(key); entry = undefined; }
    if (entry) return entry;
    // Reserve pending bytes too. Never revoke a Blob still used by a displayed
    // player merely to make room; later derivatives retain native range URLs.
    const reserved = Array.from(entries.values()).reduce((sum, item) => sum + item.expectedBytes, 0);
    const bytes = source(asset)!.size!;
    if (reserved + bytes > MAX_SESSION_BYTES) return undefined;
    const controller = new AbortController();
    const created: Entry = { controller, consumers: new Set(), promise: Promise.resolve(''), expectedBytes: bytes };
    entries.set(key, created);
    created.promise = download(asset, controller).then(url => {
      if (disposed || controller.signal.aborted) { URL.revokeObjectURL(url); throw ownAbort('Preview replaced.'); }
      created.url = url;
      return url;
    }).catch(error => {
      // A native fallback must not restart the same failed full download on
      // every timeline edit. A renewed URL can retry immediately; user-driven
      // cancellation never enters this short failure backoff.
      if (!disposed && created.consumers.size) failures.set(key, { url: preview(asset)!, retryAt: Date.now() + 60_000 });
      if (entries.get(key) === created) entries.delete(key);
      throw error;
    });
    // An aborted caller can leave before the shared fetch settles. Its rejection
    // remains observed even when another call has already created a new entry.
    void created.promise.catch(() => {});
    return created;
  }
  async function prepareAsset(asset: PreviewAsset, signal: AbortSignal, maxBytes: number): Promise<MediaAsset> {
    const url = preview(asset);
    if (!url) return asset; // Never download or copy an original video source.
    const size = source(asset)!.size;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0 || size > maxBytes || typeof URL.createObjectURL !== 'function') return nativeAsset(asset);
    const entry = entryFor(asset);
    if (!entry) return nativeAsset(asset);
    if (entry.url) return playable(asset, entry.url);
    const consumer = Symbol();
    entry.consumers.add(consumer);
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(abortReason(signal));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      const resolved = await Promise.race([entry.promise, cancelled]);
      signal.throwIfAborted();
      return playable(asset, resolved);
    } catch (error) {
      if (signal.aborted) throw abortReason(signal);
      if (disposed) throw ownAbort('Preview disposed.');
      // A cache failure still leaves the private derivative available to native
      // byte-range playback; it never substitutes a partial downloaded Blob.
      return playable(asset, url);
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
      entry.consumers.delete(consumer);
      if (!entry.url && entry.consumers.size === 0) entry.controller.abort(ownAbort('Preview no longer needed.'));
    }
  }
  return {
    /** Local copies for derivatives up to `maxBytes`; larger ones keep their native range URL. */
    async prepare(assets: MediaAsset[], signal: AbortSignal, maxBytes = MAX_LOCAL_COPY_BYTES): Promise<MediaAsset[]> {
      signal.throwIfAborted();
      if (disposed) throw ownAbort('Preview disposed.');
      return Promise.all(assets.map(asset => prepareAsset(asset, signal, Math.min(maxBytes, MAX_LOCAL_COPY_BYTES))));
    },
    cachedAssets(assets: MediaAsset[]): MediaAsset[] { return assets.map(nativeAsset); },
    dispose() {
      if (disposed) return;
      disposed = true;
      const closed = ownAbort('Preview closed.');
      for (const entry of entries.values()) { entry.controller.abort(closed); if (entry.url) URL.revokeObjectURL(entry.url); }
      entries.clear();
      failures.clear();
    },
  };
}
