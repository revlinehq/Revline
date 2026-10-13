import { NEUTRAL_MOTION, validateClipEffects, visibleMotion, type MotionKeyframe } from './clip-effects';
import { MAX_CLIP_VOLUME } from './clip-volume';
import { serializeTextAnimation, textAnimationSteps } from './text-animation';
import { validateVisualEffects } from './visual-effects';
import { visualEffectsRuntimeScript } from './visual-effects-runtime';
import { remotionTextSources } from './remotion-text';
import { playbackRateOf, sourceEndOf, timelineTimeAtSource, validatePlaybackRate } from './playback-rate';
import { dimensions, timelineDuration, deriveTrackCounts, normalizeTimeline, trackOf, DEFAULT_CROP, DEFAULT_TRANSFORM, type Clip, type MediaAsset, type Timeline, type SourceCrop } from './types';

export type CompositionOptions = {
  resolution?: 720 | 1080;
  fps?: 24 | 30 | 60;
  gsapUrl?: string;
  visualEffectsUrl?: string;
  remotionTextUrl?: string;
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
  const end = sourceEndOf(clip);
  return [at(clip.sourceStart), ...samples.filter(sample => sample.time > clip.sourceStart && sample.time < end), at(end)];
}

/** One trusted template drives both the player and MP4 renderer. User text stays text. */
export function generateComposition(timeline: Timeline, assets: MediaAsset[], options: CompositionOptions = {}) {
  timeline = normalizeTimeline(timeline);
  const duration = timelineDuration(timeline);
  if (!Number.isFinite(duration)) throw new Error('Timeline duration must be finite.');
  const resolution = options.resolution ?? 1080;
  const { width, height } = dimensions(timeline.aspectRatio, resolution);
  const fps = options.fps ?? timeline.fps;
  if (![24, 30, 60].includes(fps)) throw new Error('Frame rate must be 24, 30, or 60 fps.');
  const assetMap = new Map(assets.map(asset => [asset._id, asset]));
  deriveTrackCounts(timeline);
  const scale = resolution / 1080;
  const animation: string[] = [];
  function animateKeys(selector: string, clip: Clip, motion: MotionKeyframe[], vars: (key: MotionKeyframe) => Record<string, string | number>, neutral: MotionKeyframe, ease = 'none') {
    if (!motion.length) return;
    if (clip.kind === 'effect') animation.push(`timeline.set('${selector}',${JSON.stringify(vars(neutral))},0);`);
    animation.push(`timeline.set('${selector}',${JSON.stringify(vars(motion[0]))},${clip.kind === 'effect' ? clip.start : 0});`);
    for (let k = 1; k < motion.length; k++) animation.push(`timeline.fromTo('${selector}',${JSON.stringify(vars(motion[k - 1]))},${JSON.stringify({ ...vars(motion[k]), duration: motion[k].time - motion[k - 1].time, ease, immediateRender: false })},${clip.start + motion[k - 1].time});`);
    if (clip.kind === 'effect') animation.push(`timeline.set('${selector}',${JSON.stringify(vars(neutral))},${clip.start + clip.duration});`);
  }
  const nodes = timeline.clips.map((clip, index) => {
    validateClip(clip);
    validateClipEffects(clip);
    validateVisualEffects(clip);
    validatePlaybackRate(clip);
    const id = `clip-${index}`;
    const start = clip.start;
    const end = start + clip.duration;
    const motion = visibleMotion(clip);
    const motionVars = (key: MotionKeyframe) => ({ x: key.x * width, y: key.y * height, scale: key.scale, rotation: key.rotation, opacity: key.opacity, filter: `brightness(${key.brightness})` });
    if (clip.kind === 'effect' && clip.effectPreset === 'cinematic-bars') {
      for (const side of ['top', 'bottom'] as const) animateKeys(`#${id}-bar-${side}`, clip, motion, key => ({ y: 0, yPercent: (side === 'top' ? -100 : 100) * (1 - key.opacity) }), { time: 0, ...NEUTRAL_MOTION, opacity: 0 }, 'power2.inOut');
    } else if (clip.kind !== 'caption' && clip.kind !== 'graphic') animateKeys(`#${id}-motion`, clip, motion, motionVars, { time: 0, ...NEUTRAL_MOTION });
    // Adjustment wrappers are always mounted. A timed HyperFrames root would
    // hide all the footage it contains before and after the effect range.
    if (clip.kind === 'effect') return '';
    const trackIndex = compositionTrackIndex(clip);
    const zIndex = layerZIndex(clip, index);
    // HyperFrames activates data-start/data-duration clip roots. Animations target
    // children or crop properties so exact-zero seeks never fight its visibility.
    const timing = `id="${id}" data-start="${start}" data-duration="${clip.duration}" data-end="${end}" data-track-index="${trackIndex}"`;
    if (clip.kind === 'caption' || clip.kind === 'graphic') {
      const fontSize = bounded(clip.fontSize, clip.kind === 'caption' ? 52 : 92, 8, 300) * scale;
      const x = bounded(clip.x, 0.5, 0, 1) * 100;
      const y = bounded(clip.y, clip.kind === 'caption' ? 0.82 : 0.5, 0, 1) * 100;
      animation.push(`{const textTimeline=gsap.timeline();timeline.add(textTimeline,0);window.__revlineTextTimelines['${id}']=textTimeline;${clip.textTemplate ? '' : textAnimationSteps(clip, index, width, height, resolution).map(step => serializeTextAnimation(step, 'textTimeline')).join('')}}`);
      const style = `left:${x}%;top:${y}%;font-size:${fontSize}px;color:${color(clip.color, '#F4F4F0')};z-index:${zIndex};mix-blend-mode:${clip.blendMode ?? 'normal'}`;
      const background = color(clip.background, 'transparent');
      return `<div ${timing} class="overlay ${clip.kind}" style="${style}"><span id="${id}-motion" class="text-motion"><span class="text-content" style="background:${background}">${escapeHtml((clip.text ?? '').slice(0, 2000))}</span></span></div>`;
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
      frameStyle = `mix-blend-mode:${clip.blendMode ?? 'normal'};left:${(transform.x - 0.5) * width}px;top:${(transform.y - 0.5) * height}px;transform:rotate(${transform.rotation}deg) scale(${transform.scale});opacity:${transform.opacity};z-index:${zIndex}`;
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
          animation.push(`timeline.to('#${id}',{left:${rect.left - rect.window.left},top:${rect.top - rect.window.top},duration:${(focus[sample].time - focus[sample - 1].time) / playbackRateOf(clip)},ease:'none'},${timelineTimeAtSource(clip, focus[sample - 1].time)});`);
        }
      }
    }
    const volume = bounded(clip.volume, 1, 0, MAX_CLIP_VOLUME);
    const attrs = `${timing} data-media-start="${clip.sourceStart}" data-volume="${volume}"${clip.kind === 'video' || clip.kind === 'audio' ? ` data-playback-rate="${playbackRateOf(clip)}"` : ''}`;
    const frame = (media: string) => `<div id="${id}-frame" data-visual-clip="${escapeHtml(clip.id)}" class="visual-frame" style="${frameStyle}"><div id="${id}-motion" class="motion-frame"><div class="source-window" style="${windowStyle}">${media}</div></div></div>`;
    if (clip.kind === 'image') return frame(`<img ${attrs} crossorigin="anonymous" src="${src}" class="visual" style="${sourceStyle}" alt="" />`);
    if (clip.kind === 'audio') return `<audio ${attrs} crossorigin="anonymous" src="${src}" preload="auto"></audio>`;
    return frame(`<video ${attrs} crossorigin="anonymous" src="${src}" class="visual" style="${sourceStyle}" playsinline preload="auto"${volume === 0 ? ' muted' : ''}></video>`);
  });
  let compositionNodes = nodes.join('\n');
  if (timeline.clips.some(clip => clip.kind === 'effect')) {
    let visualStack = '';
    for (let track = 1; track <= 24; track++) {
      // Wrap the accumulated lower tracks before adding visuals on this track.
      // A title above an effect stays crisp; audio stays outside every wrapper.
      timeline.clips.forEach((clip, index) => {
        if (clip.kind !== 'effect' || trackOf(clip) !== track) return;
        const bars = clip.effectPreset === 'cinematic-bars' ? `<div class="cinematic-bars"><div id="clip-${index}-bar-top" class="cinematic-bar top"></div><div id="clip-${index}-bar-bottom" class="cinematic-bar bottom"></div></div>` : '';
        visualStack = `<div id="clip-${index}-motion" data-effect-clip="${escapeHtml(clip.id)}" class="adjustment-layer" style="z-index:${track * 256 - 1}">${visualStack}${bars}</div>`;
      });
      timeline.clips.forEach((clip, index) => {
        if (clip.kind !== 'audio' && clip.kind !== 'effect' && trackOf(clip) === track) visualStack += nodes[index];
      });
    }
    compositionNodes = visualStack + timeline.clips.map((clip, index) => clip.kind === 'audio' ? nodes[index] : '').join('');
  }
  const safeDuration = Math.max(duration, 1 / fps);
  const gsapUrl = mediaUrl(options.gsapUrl ?? '/vendor/gsap.min.js');
  const visualEffectsUrl = mediaUrl(options.visualEffectsUrl ?? (/^https?:/i.test(options.gsapUrl ?? '') ? new URL('/vendor/visual-effects.js', options.gsapUrl).href : '/vendor/visual-effects.js'));
  const hasText = timeline.clips.some(clip => clip.kind === 'caption' || clip.kind === 'graphic');
  const remotionTextUrl = mediaUrl(options.remotionTextUrl ?? (/^https?:/i.test(options.gsapUrl ?? '') ? new URL('/vendor/remotion-text.js', options.gsapUrl).href : '/vendor/remotion-text.js'));
  const textSources = JSON.stringify(remotionTextSources(timeline.clips, fps, resolution)).replace(/</g, '\\u003c');
  const defaultFontUrl = /^https?:/i.test(options.gsapUrl ?? '') ? new URL('/fonts/space-grotesk-latin.woff2', options.gsapUrl).href : '/fonts/space-grotesk-latin.woff2';
  const fontUrl = mediaUrl(options.fontUrl ?? defaultFontUrl);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:300 700;font-display:block;src:url('${fontUrl}') format('woff2')}
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#0B0C0E;font-family:'Space Grotesk',Arial,Helvetica,sans-serif}*{box-sizing:border-box}#composition{isolation:isolate;position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#0B0C0E}.visual-frame{position:absolute;width:${width}px;height:${height}px;overflow:hidden;transform-origin:center}.motion-frame{width:100%;height:100%;transform-origin:center}.text-motion{display:inline-block}.source-window{position:absolute;overflow:hidden}.visual{position:absolute}.overlay{position:absolute;max-width:90%;width:max-content;transform:translate(-50%,-50%);font-weight:700;line-height:1.12;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere}.text-content{display:inline-block;padding:${10 * scale}px ${18 * scale}px;border-radius:${8 * scale}px}.caption{text-shadow:0 2px 12px #0009}audio{position:absolute}
.adjustment-layer{position:absolute;inset:0;transform-origin:center;pointer-events:none}
[data-revline-effects]{opacity:0!important}.visual-effect-output{position:absolute;pointer-events:none}
.cinematic-bars{position:absolute;inset:0;overflow:hidden;z-index:2147483647;pointer-events:none}.cinematic-bar{position:absolute;left:0;right:0;height:12%;background:#000}.cinematic-bar.top{top:0;transform:translateY(-100%)}.cinematic-bar.bottom{bottom:0;transform:translateY(100%)}
</style><script src="${gsapUrl}"></script><script src="${visualEffectsUrl}"></script>${hasText ? `<script src="${remotionTextUrl}"></script>` : ''}</head><body><div id="composition" data-composition-id="revline" data-duration="${safeDuration}" data-width="${width}" data-height="${height}" data-fps="${fps}">${compositionNodes}</div><script>
const timeline=gsap.timeline({paused:true});
window.__revlineTextTimelines={};
${animation.join('\n')}
timeline.to({},{duration:${safeDuration}},0);
window.__timelines=window.__timelines||{};window.__timelines.revline=timeline;
${visualEffectsRuntimeScript(timeline.clips.flatMap((clip, index) => clip.kind === 'video' || clip.kind === 'image' ? [{ id: `clip-${index}`, colorGrade: clip.colorGrade, zoomBlur: clip.zoomBlur, glitch: clip.glitch, invert: clip.invert }] : []), fps, resolution)}
${hasText ? `if(window.__revlineRemotionText)window.__revlineRemotionController=window.__revlineRemotionText.install(${textSources});else if(${textSources}.length)throw new Error('Text template renderer failed to load.');` : ''}
document.querySelectorAll('video,audio').forEach(media=>{media.volume=Math.min(1,Number(media.dataset.volume));media.preservesPitch=true;});
</script></body></html>`;
}
