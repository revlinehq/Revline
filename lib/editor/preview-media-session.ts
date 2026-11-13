import type { CompositionWindow } from './composition-window';
import { guardPreviewBuffering } from './preview-buffering';
import { waitForPreviewMedia } from './preview-readiness';
import { warmPreviewMedia } from './preview-media-warmup';
import { recoverMediaSource, watchPreviewMediaStalls } from './media-source-recovery';
import { previewSourceAt } from './preview-segments';
import { previewMediaReady } from './preview-readiness';
import { sourceTimeAt } from './playback-rate';
import type { MediaAsset, Timeline } from './types';

export type PreviewTransport = EventTarget & { paused: boolean; play(): void; pause(): void; seek(time: number): void };
export type PreviewMediaRefresh = (assetIds: string[]) => Promise<{ _id: string; url: string | null; previewUrl?: string | null;previewSegments?:MediaAsset['previewSegments'] }[]>;
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

function redactedMessage(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value : fallback;
  return text.replace(/\b(?:https?|blob|data):[^\s"'<>]+/gi, '[media source]').slice(0, 500);
}

const REFRESH_TIMEOUT_MS = 15_000;

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
  let rangeWaiting=false;
  const refreshedUrls=new Map<string,string>();
  // The runtime suspends its AudioContext while paused. A context that cannot
  // resume (an audio device lost during sleep, a stalled resume) freezes the
  // transport clock, so the session keeps a handle on every context it sees.
  const contexts=new Set<AudioContext>();
  const audioPrototype=(document.defaultView as (Window&typeof globalThis)|null)?.AudioContext?.prototype;
  const nativeAudio=audioPrototype?{suspend:audioPrototype.suspend,resume:audioPrototype.resume}:null;
  if(audioPrototype&&nativeAudio){
    audioPrototype.suspend=function(this:AudioContext){contexts.add(this);return nativeAudio.suspend.call(this);};
    audioPrototype.resume=function(this:AudioContext){contexts.add(this);return nativeAudio.resume.call(this);};
  }
  /** Resume inside the Play gesture, before the runtime's own async wake. */
  const wakeAudio=()=>{for(const context of contexts){if(context.state==='closed')contexts.delete(context);else if(context.state!=='running')void context.resume().catch(()=>{});}};
  const guard = guardPreviewBuffering(document, transport, readTime,
    options.onDiagnostic ? () => { if (!disposed) options.onDiagnostic?.('active media buffering exceeded 2s'); } : undefined,
    waiting => { if (!disposed) options.onWaiting(waiting||rangeWaiting); });
  function selectSources(time:number) {
    let pending=false;
    for(const media of document.querySelectorAll<HTMLMediaElement>('video[data-source-clip]')){
      const clip=timeline.clips.find(clip=>clip.id===media.dataset.sourceClip),asset=assets.find(asset=>asset._id===clip?.assetId);
      if(!clip||!asset)continue;
      const active=time>=clip.start&&time<clip.start+clip.duration;
      if(!active&&!media.hasAttribute('data-revline-transition-visible'))continue;
      const sourceTime=sourceTimeAt(clip,Math.max(clip.start,Math.min(time,clip.start+clip.duration-1/timeline.fps)));
      const selected=previewSourceAt(asset,sourceTime),url=selected.url?refreshedUrls.get(selected.url)??selected.url:null;
      media.toggleAttribute('data-preview-pending',selected.pending);
      if(selected.pending){
        if(active)pending=true;
        if(media.hasAttribute('src')){media.removeAttribute('src');media.load();}
        continue;
      }
      const offset=selected.offset;
      media.dataset.previewOffset=String(offset);media.dataset.mediaStart=String(clip.sourceStart-offset);
      if(url&&media.getAttribute('src')!==url){
        const replace=()=>{media.src=url;media.currentTime=Math.max(0,sourceTime-offset);};
        if(active&&!transport.paused)guard.resync(replace);else replace();
        if(active)pending=true;
      }
      if(active&&rangeWaiting&&!previewMediaReady(media,time))pending=true;
    }
    if(pending&&!rangeWaiting){rangeWaiting=true;options.onWaiting(true);}
    else if(!pending&&rangeWaiting){rangeWaiting=false;if(!guard.isBuffering())options.onWaiting(false);}
  }
  selectSources(readTime());
  const sourceTimer=setInterval(()=>selectSources(readTime()),100);
  const stopWarmup = warmPreviewMedia(document, readTime);
  const stamp = (asset: MediaAsset | undefined) => JSON.stringify([asset?.url, asset?.previewUrl, asset?.previewVersion, asset?.previewSize,asset?.previewSegments]);
  const nodeSource = (media: HTMLMediaElement) => media.getAttribute?.('src') ?? media.src;
  const currentRecovery = (media: HTMLMediaElement, request: { assetId: string; stamp: string; source: string | undefined }) => media.isConnected &&
    timeline.clips.find(clip => clip.id === media.dataset.sourceClip)?.assetId === request.assetId && stamp(assets.find(asset => asset._id === request.assetId)) === request.stamp && nodeSource(media) === request.source;
  function refreshSource(assetId: string,sourceTime:number): Promise<string | null> {
    const asset = assets.find(asset => asset._id === assetId);
    if(!asset)return Promise.resolve(null);
    const generation=JSON.stringify([stamp(asset),previewSourceAt(asset,sourceTime).offset]),existing = refreshes.get(assetId);
    if (existing?.stamp===generation) return existing.promise;
    const url = previewSourceAt(asset,sourceTime).url;
    if (url?.startsWith('blob:') || !options.refreshMedia) return Promise.resolve(url);
    // A refresh sent while the backend connection is down after a long idle
    // can stay pending; bound it so stall recovery can try again.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new DOMException('Refreshing the source took too long.', 'TimeoutError')), REFRESH_TIMEOUT_MS); });
    const request = Promise.race([Promise.resolve().then(() => options.refreshMedia!([assetId])), timeout]).finally(() => clearTimeout(timer)).then(patches => {
      const patch = patches.find(patch => patch._id === assetId);
      // Playback refresh authorizes the derivative first when one exists.
      if(!asset||!patch)return url;
      const fresh=previewSourceAt({...asset,...patch},sourceTime).url;
      if(url&&fresh)refreshedUrls.set(url,fresh);
      return fresh;
    });
    const refresh={stamp:generation,promise:request};refreshes.set(assetId,refresh);
    void request.finally(() => { if (refreshes.get(assetId) === refresh) refreshes.delete(assetId); }).catch(() => {});
    return request;
  }
  async function recover(media: HTMLMediaElement, quiet = false) {
    if(media.hasAttribute('data-preview-pending'))return;
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
      try { fresh = await Promise.race([refreshSource(sourceClip.assetId,sourceTimeAt(sourceClip,readTime())), cancelled]); }
      finally { if (cancel) request.controller.signal.removeEventListener('abort', cancel); }
      request.controller.signal.throwIfAborted();
      if (!currentRecovery(media, request)) return;
      if (!fresh) throw new Error('No playable source.');
      if(!assets.find(asset=>asset._id===sourceClip.assetId)?.previewSegments?.length)recovered.set(sourceClip.assetId, { original: assets.find(asset => asset._id === sourceClip.assetId)?.url ?? null, url: fresh });
      request.source = fresh;
      await recoverMediaSource(media, fresh, {
        signal: request.controller.signal,
        position: () => sourceTimeAt(timeline.clips.find(clip => clip.id === media.dataset.sourceClip) ?? sourceClip, readTime())-Number(media.dataset.previewOffset??0),
        playing: () => {
          const current = timeline.clips.find(clip => clip.id === media.dataset.sourceClip), time = readTime();
          return !transport.paused && !!current && time >= current.start && time < current.start + current.duration;
        },
        redraw: () => (document.defaultView as CompositionWindow | null)?.__revlineEffects?.redraw(),
      });
    } catch (cause) {
      if (disposed || lifetime.signal.aborted || request.controller.signal.aborted) return;
      const name = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name) : 'UnknownError';
      if (quiet) console.warn('[Revline playback recovery]', JSON.stringify({ reason: 'source reload failed', id: media.dataset.sourceClip, readyState: media.readyState, networkState: media.networkState, seeking: media.seeking, errorType: /^[A-Za-z]+Error$/.test(name) ? name : 'UnknownError' }));
      // A slow refresh is transient: the stall watcher or the Play watchdog retries it.
      if (name === 'TimeoutError') { console.warn('[Revline playback recovery]', JSON.stringify({ reason: 'source refresh timed out', id: media.dataset.sourceClip })); return; }
      if (name === 'NotAllowedError') { guard.pause(); error('The media has recovered. Press play to resume.'); }
      else if (!quiet || media.error) error('This source is unavailable. Reimport the clip or reload the project.');
    } finally {
      lifetime.signal.removeEventListener('abort', stopped);
      // A revived element may already run a newer recovery; leave its markers.
      if (recoveries.get(media) === request) { recoveries.delete(media); attempted.delete(media); }
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
      timeline = nextTimeline; assets = nextAssets;selectSources(readTime());
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
    play() { if (!disposed) { wakeAudio(); guard.play(); } },
    /** Recover a Play that made no progress: wake audio, re-sign and reload
     * every active source that has failed, emptied or lost its data, then
     * re-enter the readiness gate at the current position. */
    revive() {
      if (disposed) return;
      wakeAudio();
      const time = readTime();
      for (const media of document.querySelectorAll<HTMLMediaElement>('video[data-start],audio[data-start]')) {
        const start = Number(media.dataset.start), end = Number(media.dataset.end ?? start + Number(media.dataset.duration));
        if (time < start || time >= end || media.hasAttribute('data-preview-pending') || media.tagName === 'AUDIO' && Number(media.dataset.volume ?? 1) === 0) continue;
        if (!media.error && media.networkState !== media.NETWORK_NO_SOURCE && media.readyState >= media.HAVE_CURRENT_DATA) continue;
        // Request a newly signed URL even when an earlier refresh is still pending.
        const assetId = timeline.clips.find(clip => clip.id === media.dataset.sourceClip)?.assetId;
        if (assetId) refreshes.delete(assetId);
        recoveries.get(media)?.controller.abort(); attempted.delete(media); void recover(media, true);
      }
      guard.resync(() => transport.seek(time));
    },
    pause() { if (!disposed) guard.pause(); },
    seek(time: number) { if (!disposed) { guard.cancel(); selectSources(time); transport.seek(time); } },
    resync(seek: () => void = () => transport.seek(readTime())) { if (!disposed) guard.resync(seek); },
    isPlaying: guard.isPlaying,
    isBuffering: guard.isBuffering,
    dispose() {
      if (disposed) return;
      disposed = true; lifetime.abort(); clearInterval(sourceTimer);stopStalls(); stopWarmup(); guard.dispose();
      document.removeEventListener('error', mediaError, true);
      document.defaultView?.removeEventListener('revline-effects-error', effectsError);
      if (audioPrototype && nativeAudio) { audioPrototype.suspend = nativeAudio.suspend; audioPrototype.resume = nativeAudio.resume; }
      contexts.clear();
      refreshes.clear(); recovered.clear();refreshedUrls.clear();
    },
  };
}
