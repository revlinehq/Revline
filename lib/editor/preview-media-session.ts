import { guardPreviewBuffering } from './preview-buffering';
import { waitForPreviewMedia } from './preview-readiness';
import { warmPreviewMedia } from './preview-media-warmup';
import { recoverMediaSource, watchPreviewMediaStalls } from './media-source-recovery';
import { sourceTimeAt } from './playback-rate';
import type { MediaAsset, Timeline } from './types';

export type PreviewTransport = EventTarget & { paused: boolean; play(): void; pause(): void; seek(time: number): void };
export type PreviewMediaRefresh = (assetIds: string[]) => Promise<{ _id: string; url: string | null; previewUrl?: string | null }[]>;
export type PreviewMediaSessionOptions = {
  document: Document;
  transport: PreviewTransport;
  readTime(): number;
  timeline: Timeline;
  assets: MediaAsset[];
  refreshMedia?: PreviewMediaRefresh;
  onError(message: string): void;
  onWaiting(waiting: boolean): void;
  onSlowLoad?(): void;
  onDiagnostic?(reason: string): void;
};
type PlaybackAsset = MediaAsset & { previewUrl?: string | null };

function redactedMessage(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value : fallback;
  return text.replace(/\b(?:https?|blob|data):[^\s"'<>]+/gi, '[media source]').slice(0, 500);
}

/** Own the lifetime of every native loading, readiness and recovery operation. */
export function createPreviewMediaSession(options: PreviewMediaSessionOptions) {
  const { document, transport, readTime } = options;
  let timeline = options.timeline, assets = options.assets, disposed = false;
  const lifetime = new AbortController();
  const attempted = new WeakSet<HTMLMediaElement>();
  const recoveries = new Map<HTMLMediaElement, { controller: AbortController; assetId: string; stamp: string; source: string | undefined }>();
  const refreshes = new Map<string, { stamp: string; promise: Promise<string | null> }>();
  const recovered = new Map<string, { original: string | null; url: string }>();
  const error = (message: string) => { if (!disposed) options.onError(redactedMessage(message, 'Could not load this media.')); };
  const guard = guardPreviewBuffering(document, transport, readTime,
    options.onDiagnostic ? () => { if (!disposed) options.onDiagnostic?.('active media buffering exceeded 2s'); } : undefined,
    waiting => { if (!disposed) options.onWaiting(waiting); });
  const stopWarmup = warmPreviewMedia(document, readTime);
  const playableUrl = (asset: PlaybackAsset | undefined) => asset?.url?.startsWith('blob:') ? asset.url : asset?.previewUrl ?? asset?.url ?? null;
  const stamp = (asset: MediaAsset | undefined) => JSON.stringify([asset?.url, asset?.previewUrl, asset?.previewVersion, asset?.previewSize]);
  const nodeSource = (media: HTMLMediaElement) => media.getAttribute?.('src') ?? media.src;
  const currentRecovery = (media: HTMLMediaElement, request: { assetId: string; stamp: string; source: string | undefined }) => media.isConnected &&
    timeline.clips.find(clip => clip.id === media.dataset.sourceClip)?.assetId === request.assetId && stamp(assets.find(asset => asset._id === request.assetId)) === request.stamp && nodeSource(media) === request.source;
  function refreshSource(assetId: string): Promise<string | null> {
    const asset = assets.find(asset => asset._id === assetId) as PlaybackAsset | undefined;
    const generation=stamp(asset),existing = refreshes.get(assetId);
    if (existing?.stamp===generation) return existing.promise;
    const url = playableUrl(asset);
    if (url?.startsWith('blob:') || !options.refreshMedia) return Promise.resolve(url);
    const request = Promise.resolve().then(() => options.refreshMedia!([assetId])).then(patches => {
      const patch = patches.find(patch => patch._id === assetId);
      // Playback refresh authorizes the derivative first when one exists.
      return patch?.previewUrl ?? patch?.url ?? url;
    });
    const refresh={stamp:generation,promise:request};refreshes.set(assetId,refresh);
    void request.finally(() => { if (refreshes.get(assetId) === refresh) refreshes.delete(assetId); }).catch(() => {});
    return request;
  }
  async function recover(media: HTMLMediaElement, quiet = false) {
    if (disposed || !media || !['VIDEO', 'AUDIO'].includes(media.tagName) || attempted.has(media)) return;
    const sourceClip = timeline.clips.find(clip => clip.id === media.dataset.sourceClip);
    if (!sourceClip?.assetId) return;
    attempted.add(media);
    const request = { controller: new AbortController(), assetId: sourceClip.assetId, stamp: stamp(assets.find(asset => asset._id === sourceClip.assetId)), source: nodeSource(media) };
    recoveries.set(media, request);
    const stopped = () => request.controller.abort(lifetime.signal.reason);
    lifetime.signal.addEventListener('abort', stopped, { once: true });
    try {
      let cancel: (() => void) | undefined;
      const cancelled = new Promise<never>((_resolve, reject) => { cancel = () => reject(new DOMException('Preview source changed.', 'AbortError')); request.controller.signal.addEventListener('abort', cancel, { once: true }); });
      let fresh: string | null;
      try { fresh = await Promise.race([refreshSource(sourceClip.assetId), cancelled]); }
      finally { if (cancel) request.controller.signal.removeEventListener('abort', cancel); }
      request.controller.signal.throwIfAborted();
      if (!currentRecovery(media, request)) return;
      if (!fresh) throw new Error('No playable source.');
      recovered.set(sourceClip.assetId, { original: assets.find(asset => asset._id === sourceClip.assetId)?.url ?? null, url: fresh });
      request.source = fresh;
      await recoverMediaSource(media, fresh, {
        signal: request.controller.signal,
        position: () => sourceTimeAt(timeline.clips.find(clip => clip.id === media.dataset.sourceClip) ?? sourceClip, readTime()),
        playing: () => {
          const current = timeline.clips.find(clip => clip.id === media.dataset.sourceClip), time = readTime();
          return !transport.paused && !!current && time >= current.start && time < current.start + current.duration;
        },
        redraw: () => (document.defaultView as (Window & { __revlineEffects?: { redraw(): void } }) | null)?.__revlineEffects?.redraw(),
      });
    } catch (cause) {
      if (disposed || lifetime.signal.aborted || request.controller.signal.aborted) return;
      const name = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name) : 'UnknownError';
      if (quiet) console.warn('[Revline playback recovery]', JSON.stringify({ reason: 'source reload failed', id: media.dataset.sourceClip, readyState: media.readyState, networkState: media.networkState, seeking: media.seeking, errorType: /^[A-Za-z]+Error$/.test(name) ? name : 'UnknownError' }));
      if (name === 'NotAllowedError') { guard.pause(); error('The media has recovered. Press play to resume.'); }
      else if (!quiet || media.error) error('This source is unavailable. Reimport the clip or reload the project.');
    } finally {
      lifetime.signal.removeEventListener('abort', stopped);
      if (recoveries.get(media) === request) recoveries.delete(media);
      attempted.delete(media);
    }
  }
  const mediaError = (event: Event) => { void recover(event.target as HTMLMediaElement); };
  const effectsError = (event: Event) => error(redactedMessage((event as CustomEvent<unknown>).detail, 'Could not preview this effect.'));
  document.addEventListener('error', mediaError, true);
  document.defaultView?.addEventListener('revline-effects-error', effectsError);
  const stopStalls = watchPreviewMediaStalls(document, readTime, media => recover(media, true));
  if (document.documentElement?.dataset.visualEffectsError) error(document.documentElement.dataset.visualEffectsError);
  return {
    resolveAssets(nextAssets: MediaAsset[]): MediaAsset[] {
      return nextAssets.map(asset => {
        const replacement = recovered.get(asset._id);
        return replacement && replacement.original === asset.url ? { ...asset, url: replacement.url } : asset;
      });
    },
    update(nextTimeline: Timeline, nextAssets: MediaAsset[]) {
      timeline = nextTimeline; assets = nextAssets;
      for (const [media, request] of recoveries) if (!currentRecovery(media, request)) request.controller.abort();
      for (const [id, value] of recovered) if (assets.find(asset => asset._id === id)?.url !== value.original) recovered.delete(id);
      // Live reconciliation may restore a still-expired prop URL. The source
      // owner reapplies its successful refresh without rebuilding the player.
      for (const media of document.querySelectorAll<HTMLMediaElement>('video[data-start],audio[data-start]')) {
        const clip = timeline.clips.find(clip => clip.id === media.dataset.sourceClip), replacement = clip?.assetId ? recovered.get(clip.assetId) : undefined;
        if (replacement && media.getAttribute('src') === replacement.original && media.getAttribute('src') !== replacement.url) media.src = replacement.url;
      }
    },
    async whenReady(time: number, signal: AbortSignal, onThumbnail?: (url: string) => void, onSlow?: () => void) {
      const waiting = new AbortController();
      const aborted = () => waiting.abort(signal.aborted ? signal.reason : lifetime.signal.reason);
      signal.addEventListener('abort', aborted, { once: true }); lifetime.signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted || lifetime.signal.aborted) aborted();
      try { waiting.signal.throwIfAborted(); await waitForPreviewMedia(document, time, waiting.signal, onThumbnail, onSlow ?? options.onSlowLoad); }
      finally { signal.removeEventListener('abort', aborted); lifetime.signal.removeEventListener('abort', aborted); }
    },
    play() { if (!disposed) guard.play(); },
    pause() { if (!disposed) guard.pause(); },
    seek(time: number) { if (!disposed) { guard.cancel(); transport.seek(time); } },
    resync(seek: () => void = () => transport.seek(readTime())) { if (!disposed) guard.resync(seek); },
    isPlaying: guard.isPlaying,
    isBuffering: guard.isBuffering,
    dispose() {
      if (disposed) return;
      disposed = true; lifetime.abort(); stopStalls(); stopWarmup(); guard.dispose();
      document.removeEventListener('error', mediaError, true);
      document.defaultView?.removeEventListener('revline-effects-error', effectsError);
      refreshes.clear(); recovered.clear();
    },
  };
}
