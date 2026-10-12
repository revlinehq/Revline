import { MAX_CLIP_VOLUME } from './clip-volume';
import { dimensions, timelineDuration, deriveTrackCounts, normalizeTimeline, trackOf, DEFAULT_CROP, DEFAULT_TRANSFORM, type Clip, type MediaAsset, type Timeline, type SourceCrop } from './types';

export type CompositionOptions = {
  resolution?: 720 | 1080;
  fps?: 24 | 30 | 60;
  gsapUrl?: string;
  fontUrl?: string;
  assetUrls?: Record<string, string>;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function mediaUrl(value: string) {
  if (/^(https?:|blob:)/i.test(value) || /^(\.\/|\/[^/])/.test(value)) return escapeHtml(value);
  throw new Error('Media and script URLs must use HTTP, a blob URL, or a local path.');
}

function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback;
}

function color(value: string | undefined, fallback: string) {
  return value && /^(#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|transparent)$/i.test(value) ? value : fallback;
}

export function layerZIndex(clip: Pick<Clip, 'kind' | 'track'>, index = 0) {
  return trackOf(clip) * 256 + index;
}

/** HyperFrames gives all visual clip kinds the same 24-track partition. */
export function compositionTrackIndex(clip: Pick<Clip, 'kind' | 'track'>) {
  return (clip.kind === 'audio' ? 24 : 0) + trackOf(clip) - 1;
}

/** Scale the retained source region, and mask removed pixels before transforming. */
export function calculateVisualRect(sourceWidth: number, sourceHeight: number, frameWidth: number, frameHeight: number, crop: SourceCrop = DEFAULT_CROP, focus?: { x: number; y: number }, fit: 'cover' | 'contain' = 'cover') {
  if (![sourceWidth, sourceHeight, frameWidth, frameHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error('Crop needs the source dimensions. Re-import this media.');
  if (![crop.left, crop.top, crop.right, crop.bottom].every(value => Number.isFinite(value) && value >= 0 && value <= 0.95) || crop.left + crop.right >= 0.95 || crop.top + crop.bottom >= 0.95) throw new Error('Crop edges must leave at least 5% of the source visible.');
  const croppedWidth = sourceWidth * (1 - crop.left - crop.right), croppedHeight = sourceHeight * (1 - crop.top - crop.bottom);
  const scale = (fit === 'contain' ? Math.min : Math.max)(frameWidth / croppedWidth, frameHeight / croppedHeight);
  const width = sourceWidth * scale, height = sourceHeight * scale;
  const window = fit === 'contain' ? { left: (frameWidth - croppedWidth * scale) / 2, top: (frameHeight - croppedHeight * scale) / 2, width: croppedWidth * scale, height: croppedHeight * scale } : { left: 0, top: 0, width: frameWidth, height: frameHeight };
  if (fit === 'contain') return { left: window.left - crop.left * width, top: window.top - crop.top * height, width, height, window };
  const x = bounded(focus?.x, (crop.left + 1 - crop.right) / 2, 0, 1);
  const y = bounded(focus?.y, (crop.top + 1 - crop.bottom) / 2, 0, 1);
  return {
    left: Math.min(-crop.left * width, Math.max(frameWidth - (1 - crop.right) * width, frameWidth / 2 - x * width)),
    top: Math.min(-crop.top * height, Math.max(frameHeight - (1 - crop.bottom) * height, frameHeight / 2 - y * height)),
    width, height, window,
  };
}

function validateClip(clip: Clip) {
  if (![clip.start, clip.duration, clip.sourceStart].every(Number.isFinite) || clip.start < 0 || clip.duration <= 0 || clip.sourceStart < 0) {
    throw new Error('Every clip must have a valid start, duration, and source offset.');
  }
}

function trimmedFocus(clip: Clip) {
  const samples = clip.focus ?? [];
  if (samples.length > 1500) throw new Error('A clip can contain at most 1500 focus samples.');
  for (const [index, sample] of samples.entries()) {
    if (![sample.time, sample.x, sample.y].every(Number.isFinite) || sample.time < 0 || sample.x < 0 || sample.x > 1 || sample.y < 0 || sample.y > 1 || (index > 0 && sample.time <= samples[index - 1].time)) throw new Error('Focus samples must have increasing source times and normalized positions.');
  }
  if (!samples.length) return [];
  function at(time: number) {
    const after = samples.findIndex(sample => sample.time >= time);
    if (after <= 0) return { ...(after === -1 ? samples[samples.length - 1] : samples[0]), time };
    const previous = samples[after - 1], next = samples[after];
    const mix = (time - previous.time) / (next.time - previous.time);
    return { time, x: previous.x + (next.x - previous.x) * mix, y: previous.y + (next.y - previous.y) * mix };
  }
  const end = clip.sourceStart + clip.duration;
  return [at(clip.sourceStart), ...samples.filter(sample => sample.time > clip.sourceStart && sample.time < end), at(end)];
}

/** One trusted template drives both the player and MP4 renderer. User text stays text. */
export function generateComposition(timeline: Timeline, assets: MediaAsset[], options: CompositionOptions = {}) {
  timeline = normalizeTimeline(timeline);
  if (timeline.clips.length > 200) throw new Error('A project can contain at most 200 clips.');
  const duration = timelineDuration(timeline);
  if (!Number.isFinite(duration) || duration > 300) throw new Error('Reels must be five minutes or shorter.');
  const resolution = options.resolution ?? 1080;
  const { width, height } = dimensions(timeline.aspectRatio, resolution);
  const fps = options.fps ?? timeline.fps;
  if (![24, 30, 60].includes(fps)) throw new Error('Frame rate must be 24, 30, or 60 fps.');
  const assetMap = new Map(assets.map(asset => [asset._id, asset]));
  deriveTrackCounts(timeline);
  const scale = resolution / 1080;
  const animation: string[] = [];
  const nodes = timeline.clips.map((clip, index) => {
    validateClip(clip);
    const id = `clip-${index}`;
    const start = clip.start;
    const end = start + clip.duration;
    const trackIndex = compositionTrackIndex(clip);
    const zIndex = layerZIndex(clip, index);
    // HyperFrames activates data-start/data-duration clip roots. Animations target
    // children or crop properties so exact-zero seeks never fight its visibility.
    const timing = `id="${id}" data-start="${start}" data-duration="${clip.duration}" data-end="${end}" data-track-index="${trackIndex}"`;
    if (clip.kind === 'caption' || clip.kind === 'graphic') {
      const fontSize = bounded(clip.fontSize, clip.kind === 'caption' ? 52 : 92, 8, 300) * scale;
      const x = bounded(clip.x, 0.5, 0, 1) * 100;
      const y = bounded(clip.y, clip.kind === 'caption' ? 0.82 : 0.5, 0, 1) * 100;
      if (clip.animation === 'fade' || clip.animation === 'rise') {
        const tween = Math.min(0.3, clip.duration / 3);
        animation.push(`timeline.fromTo('#${id} .text-content',{opacity:0${clip.animation === 'rise' ? `,y:${32 * scale}` : ''}},{opacity:1,y:0,duration:${tween},ease:'power2.out'},${start});timeline.to('#${id} .text-content',{opacity:0,duration:${tween}},${end - tween});`);
      }
      const style = `left:${x}%;top:${y}%;font-size:${fontSize}px;color:${color(clip.color, '#F4F4F0')};z-index:${zIndex}`;
      const background = color(clip.background, 'transparent');
      return `<div ${timing} class="overlay ${clip.kind}" style="${style}"><span class="text-content" style="background:${background}">${escapeHtml((clip.text ?? '').slice(0, 2000))}</span></div>`;
    }
    const asset = clip.assetId ? assetMap.get(clip.assetId) : undefined;
    const source = clip.assetId ? options.assetUrls?.[clip.assetId] ?? asset?.url : undefined;
    if (!asset || !source) throw new Error('A clip references unavailable media.');
    if (asset.kind !== clip.kind) throw new Error('The clip kind does not match its media.');
    const src = mediaUrl(source);
    let sourceStyle = 'left:0;top:0;width:100%;height:100%;object-fit:cover';
    let frameStyle = '';
    let windowStyle = 'left:0;top:0;width:100%;height:100%';
    if (clip.kind !== 'audio') {
      const focus = trimmedFocus(clip);
      const transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
      if (![transform.x, transform.y, transform.scale, transform.rotation, transform.opacity].every(Number.isFinite) || transform.x < 0 || transform.x > 1 || transform.y < 0 || transform.y > 1 || transform.scale < 0.1 || transform.scale > 5 || transform.rotation < -360 || transform.rotation > 360 || transform.opacity < 0 || transform.opacity > 1) throw new Error('The visual transform is out of range.');
      frameStyle = `left:${(transform.x - 0.5) * width}px;top:${(transform.y - 0.5) * height}px;transform:rotate(${transform.rotation}deg) scale(${transform.scale});opacity:${transform.opacity};z-index:${zIndex}`;
      const hasDimensions = !!asset.width && !!asset.height;
      if (clip.crop && !hasDimensions) throw new Error('Crop needs the source dimensions. Re-import this media.');
      if (hasDimensions) {
        const rect = calculateVisualRect(asset.width!, asset.height!, width, height, clip.crop, focus[0], clip.fit);
        windowStyle = `left:${rect.window.left}px;top:${rect.window.top}px;width:${rect.window.width}px;height:${rect.window.height}px`;
        sourceStyle = `left:${rect.left - rect.window.left}px;top:${rect.top - rect.window.top}px;width:${rect.width}px;height:${rect.height}px;object-fit:fill`;
      } else if (clip.fit === 'contain') {
        sourceStyle = 'left:0;top:0;width:100%;height:100%;object-fit:contain';
      }
      if (focus.length && hasDimensions) {
        const position = (sample: typeof focus[number]) => calculateVisualRect(asset.width!, asset.height!, width, height, clip.crop, sample, clip.fit);
        const initial = position(focus[0]);
        animation.push(`timeline.set('#${id}',{left:${initial.left - initial.window.left},top:${initial.top - initial.window.top}},${start});`);
        for (let sample = 1; sample < focus.length; sample++) {
          const rect = position(focus[sample]);
          animation.push(`timeline.to('#${id}',{left:${rect.left - rect.window.left},top:${rect.top - rect.window.top},duration:${focus[sample].time - focus[sample - 1].time},ease:'none'},${start + focus[sample - 1].time - clip.sourceStart});`);
        }
      }
    }
    const volume = bounded(clip.volume, 1, 0, MAX_CLIP_VOLUME);
    const attrs = `${timing} data-media-start="${clip.sourceStart}" data-volume="${volume}"`;
    const frame = (media: string) => `<div id="${id}-frame" data-visual-clip="${escapeHtml(clip.id)}" class="visual-frame" style="${frameStyle}"><div class="source-window" style="${windowStyle}">${media}</div></div>`;
    if (clip.kind === 'image') return frame(`<img ${attrs} src="${src}" class="visual" style="${sourceStyle}" alt="" />`);
    if (clip.kind === 'audio') return `<audio ${attrs} crossorigin="anonymous" src="${src}" preload="auto"></audio>`;
    return frame(`<video ${attrs} crossorigin="anonymous" src="${src}" class="visual" style="${sourceStyle}" playsinline preload="auto"${volume === 0 ? ' muted' : ''}></video>`);
  }).join('\n');
  const safeDuration = Math.max(duration, 1 / fps);
  const gsapUrl = mediaUrl(options.gsapUrl ?? '/vendor/gsap.min.js');
  const defaultFontUrl = /^https?:/i.test(options.gsapUrl ?? '') ? new URL('/fonts/space-grotesk-latin.woff2', options.gsapUrl).href : '/fonts/space-grotesk-latin.woff2';
  const fontUrl = mediaUrl(options.fontUrl ?? defaultFontUrl);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:300 700;font-display:block;src:url('${fontUrl}') format('woff2')}
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#0B0C0E;font-family:'Space Grotesk',Arial,Helvetica,sans-serif}*{box-sizing:border-box}#composition{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#0B0C0E}.visual-frame{position:absolute;width:${width}px;height:${height}px;overflow:hidden;transform-origin:center}.source-window{position:absolute;overflow:hidden}.visual{position:absolute}.overlay{position:absolute;max-width:90%;width:max-content;transform:translate(-50%,-50%);font-weight:700;line-height:1.12;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere}.text-content{display:inline-block;padding:${10 * scale}px ${18 * scale}px;border-radius:${8 * scale}px}.caption{text-shadow:0 2px 12px #0009}audio{position:absolute}
</style><script src="${gsapUrl}"></script></head><body><div id="composition" data-composition-id="revline" data-duration="${safeDuration}" data-width="${width}" data-height="${height}" data-fps="${fps}">${nodes}</div><script>
const timeline=gsap.timeline({paused:true});
${animation.join('\n')}
timeline.to({},{duration:${safeDuration}},0);
window.__timelines=window.__timelines||{};window.__timelines.revline=timeline;
document.querySelectorAll('video,audio').forEach(media=>{media.volume=Math.min(1,Number(media.dataset.volume));});
</script></body></html>`;
}
