import { validateVisualTransform } from './visual-inputs';
import { boundedCameraMotion } from './camera-framing';
import { calculateVisualRect } from './visual-source-geometry';
import { NEUTRAL_MOTION, cinematicBarSettings, validateClipEffects, visibleMotion, type MotionKeyframe } from './clip-effects';
import { adjustmentSources } from './adjustment-layers';
import { solidColorSources } from './solid-color-layers';
import { isTransitionClip, transitionSources } from './clip-transitions';
import { validateVisualFade } from './visual-fades';
import { audioFadeAttributes, audioVolumeEnvelope, validateAudioTimeline } from './audio-settings';
import { MAX_CLIP_VOLUME } from './clip-volume';
import { validateVisualEffects, visualEffectsOf } from './visual-effects';
import { cameraGlideBlurSource } from './camera-motion-blur';
import { visualEffectsRuntimeScript } from './visual-effects-runtime';
import { textLayerSources } from './text-layers';
import { sceneFonts, sceneLayerSources, sceneRuntimeScript, validateScene } from './scene-layers';
import { textStyle, textAppearance } from './text-style';
import { TEXT_FONTS, textFontFaceCss, type TextFontId } from './text-fonts';
import { playbackRateOf, sourceEndOf, timelineTimeAtSource, validatePlaybackRate } from './playback-rate';
import { dimensions, timelineDuration, deriveTrackCounts, normalizeTimeline, trackOf, DEFAULT_TRANSFORM, type Clip, type MediaAsset, type Timeline } from './types';

/** Export short-side pixels; 2160 (4K) is offered to Ultra accounts. */
export type ExportResolution = 720 | 1080 | 2160;
export type CompositionOptions = {
  preview?: boolean;
  resolution?: ExportResolution;
  fps?: 24 | 30 | 60;
  gsapUrl?: string;
  visualEffectsUrl?: string;
  remotionTextUrl?: string;
  remotionTransitionsUrl?: string;
  remotionRuntimeUrl?: string;
  sceneRuntimeUrl?: string;
  fontUrl?: string;
  fontUrls?: Partial<Record<TextFontId, string>>;
  assetUrls?: Record<string, string>;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function mediaUrl(value: string, sameDirectory = false) {
  // Server exports may name a file in the composition's own directory: no scheme, slash or parent.
  if (/^(https?:|blob:)/i.test(value) || /^(\.\/|\/[^/])/.test(value) || sameDirectory && /^\w[\w.-]*$/.test(value)) return escapeHtml(value);
  throw new Error('Media and script URLs must use HTTP, a blob URL, or a local path.');
}

function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback;
}

export function layerZIndex(clip: Pick<Clip, 'kind' | 'track'>, index = 0) {
  return trackOf(clip) * 256 + index;
}

/** HyperFrames gives all visual clip kinds the same 24-track partition. */
export function compositionTrackIndex(clip: Pick<Clip, 'kind' | 'track'>) {
  return (clip.kind === 'audio' ? 24 : 0) + trackOf(clip) - 1;
}

export { calculateVisualRect } from './visual-source-geometry';

function validateClip(clip: Clip) {
  if (![clip.start, clip.duration, clip.sourceStart].every(Number.isFinite) || clip.start < 0 || clip.duration <= 0 || clip.sourceStart < 0) {
    throw new Error('Every clip must have a valid start, duration, and source offset.');
  }
}

export function trimmedFocus(clip: Clip) {
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
  validateAudioTimeline(timeline);
  const transitions = transitionSources(timeline.clips, timeline.fps);
  const scale = resolution / 1080;
  const animation: string[] = [];
  function animateKeys(selector: string, clip: Clip, motion: MotionKeyframe[], vars: (key: MotionKeyframe) => Record<string, string | number>, neutral: MotionKeyframe, ease = 'none') {
    if (!motion.length) return;
    if (clip.kind === 'effect') animation.push(`timeline.set('${selector}',${JSON.stringify(vars(neutral))},0);`);
    // A path may begin already zoomed/panned. Apply its opening pose even
    // before the paused timeline has advanced from exactly zero.
    animation.push(`timeline.set('${selector}',${JSON.stringify({ ...vars(motion[0]), ...(clip.kind !== 'effect' ? { immediateRender: true } : {}) })},${clip.kind === 'effect' ? clip.start : 0});`);
    for (let k = 1; k < motion.length; k++) animation.push(`timeline.fromTo('${selector}',${JSON.stringify(vars(motion[k - 1]))},${JSON.stringify({ ...vars(motion[k]), duration: motion[k].time - motion[k - 1].time, ease, immediateRender: false })},${clip.start + motion[k - 1].time});`);
    if (clip.kind === 'effect') animation.push(`timeline.set('${selector}',${JSON.stringify(vars(neutral))},${clip.start + clip.duration});`);
  }
  const nodes = timeline.clips.map((clip, index) => {
    validateClip(clip);
    validateClipEffects(clip);
    validateVisualFade(clip);
    validateVisualEffects(clip);
    validatePlaybackRate(clip);
    validateScene(clip);
    // Silent sound still contributes to the authored duration above, but needs
    // no decoder or time-stretch/mix work in an export. Preview retains the
    // element so live volume controls can unmute it without rebuilding footage.
    if (!options.preview && clip.kind === 'audio' && clip.volume === 0) return '';
    const id = `clip-${index}`;
    const start = clip.start;
    const end = start + clip.duration;
    const motionAsset = clip.assetId ? assetMap.get(clip.assetId) : undefined;
    const motion = motionAsset ? boundedCameraMotion(clip, motionAsset, timeline.aspectRatio, visibleMotion(clip)) : visibleMotion(clip);
    const motionVars = (key: MotionKeyframe) => ({ x: key.x * width, y: key.y * height, scale: key.scale, rotation: key.rotation, opacity: key.opacity, filter: `brightness(${key.brightness})` });
    if (clip.kind !== 'effect' && clip.kind !== 'caption' && clip.kind !== 'graphic' && clip.kind !== 'solid' && clip.kind !== 'scene') animateKeys(`#${id}-motion`, clip, motion, motionVars, { time: 0, ...NEUTRAL_MOTION });
    // Adjustment wrappers are always mounted. A timed HyperFrames root would
    // hide all the footage it contains before and after the effect range.
    if (clip.kind === 'effect') return '';
    const trackIndex = compositionTrackIndex(clip);
    const zIndex = layerZIndex(clip, index);
    // The scene controller below fills this sandboxed frame and seeks its animations.
    // Untimed composition children are stamped to the whole video, and HyperFrames
    // would then show every scene on each playback frame.
    if (clip.kind === 'scene') return `<div id="${id}" data-scene-clip="${escapeHtml(clip.id)}" data-start="${start}" data-duration="${clip.duration}" data-end="${end}" data-track-index="${trackIndex}" class="scene-layer" style="z-index:${zIndex}"></div>`;
    if (clip.kind === 'solid') return `<div id="${id}" data-solid-color-clip="${escapeHtml(clip.id)}" class="solid-color-layer" style="z-index:${zIndex}"><div class="solid-color-rectangle"></div></div>`;
    // HyperFrames activates data-start/data-duration clip roots. Animations target
    // children or crop properties so exact-zero seeks never fight its visibility.
    const timing = `id="${id}" data-source-clip="${escapeHtml(clip.id)}" data-start="${start}" data-duration="${clip.duration}" data-end="${end}" data-track-index="${trackIndex}"`;
    if (clip.kind === 'caption' || clip.kind === 'graphic') {
      const style = textStyle(clip, resolution);
      const attributes = `left:${style.x * 100}%;top:${style.y * 100}%;font-size:${style.fontSize}px;font-family:'${style.fontFamily}';font-weight:${style.fontWeight};font-style:${style.fontStyle};letter-spacing:${style.letterSpacing}px;line-height:${style.lineHeight};text-align:${style.textAlign};color:${style.color};z-index:${zIndex};mix-blend-mode:${style.blendMode};transform:${style.transform}`;
      const appearance = clip.textStyle ? textAppearance(clip,resolution) : null;
      const decoration = appearance ? `;-webkit-text-stroke:${appearance.WebkitTextStroke};paint-order:stroke fill;text-shadow:${appearance.textShadow}` : '';
      return `<div id="${id}" data-text-clip="${escapeHtml(clip.id)}" class="overlay ${clip.kind}" style="${attributes}"><span id="${id}-motion" class="text-motion"><span class="text-content" style="background:${style.background};padding:${style.paddingY}px ${style.paddingX}px;border-radius:${style.borderRadius}px${decoration}">${escapeHtml(style.text)}</span></span></div>`;
    }
    const asset = clip.assetId ? assetMap.get(clip.assetId) : undefined;
    const exportSource = clip.assetId ? options.assetUrls?.[clip.assetId] : undefined;
    const source = exportSource ?? asset?.url;
    if (!asset || !source) throw new Error('A clip references unavailable media.');
    if (asset.kind !== clip.kind) throw new Error('The clip kind does not match its media.');
    const src = mediaUrl(source, exportSource !== undefined);
    let sourceStyle = 'left:0;top:0;width:100%;height:100%;object-fit:cover';
    let frameStyle = '';
    let windowStyle = 'left:0;top:0;width:100%;height:100%';
    let cameraStageStyle = `position:absolute;left:0;top:0;width:${width}px;height:${height}px`;
    if (clip.kind !== 'audio') {
      const focus = trimmedFocus(clip);
      const transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
      try{validateVisualTransform(transform);}catch{throw new Error('The visual transform is out of range.');}
      frameStyle = `mix-blend-mode:${clip.blendMode ?? 'normal'};left:${(transform.x - 0.5) * width}px;top:${(transform.y - 0.5) * height}px;transform:rotate(${transform.rotation}deg) scale(${transform.scale});opacity:${transform.opacity};z-index:${zIndex}`;
      const hasDimensions = !!asset.width && !!asset.height;
      if (clip.crop && !hasDimensions) throw new Error('Crop needs the source dimensions. Re-import this media.');
      if (hasDimensions) {
        const rect = calculateVisualRect(asset.width!, asset.height!, width, height, clip.crop, focus[0], clip.fit);
        windowStyle = `left:${rect.window.left}px;top:${rect.window.top}px;width:${rect.window.width}px;height:${rect.window.height}px`;
        cameraStageStyle = `position:absolute;left:${-rect.window.left}px;top:${-rect.window.top}px;width:${width}px;height:${height}px`;
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
    const sound=audioFadeAttributes(clip);
    const audioAttrs=clip.kind==='video'||clip.kind==='audio'?` data-fade-in="${sound.fadeIn}" data-fade-out="${sound.fadeOut}" data-automation="${escapeHtml(audioVolumeEnvelope(timeline,clip,volume))}"`:'';
    const attrs = `${timing} data-media-start="${clip.sourceStart}" data-volume="${volume}"${clip.kind === 'video' || clip.kind === 'audio' ? ` data-playback-rate="${playbackRateOf(clip)}"` : ''}${audioAttrs}`;
    const frame = (media: string) => {
      const content = `<div id="${id}-motion" class="motion-frame"><div class="source-window" style="${windowStyle}">${media}</div></div>`;
      // Camera motion reframes pixels through a stationary aperture. Ordinary
      // object motion can still move the whole clip and its clipping window.
      const view = clip.cameraMotion || clip.smoothZoom
        ? `<div class="camera-window" style="position:absolute;overflow:hidden;${windowStyle}"><div class="camera-stage" style="${cameraStageStyle}">${content}</div></div>`
        : content;
      return `<div id="${id}-frame" data-visual-clip="${escapeHtml(clip.id)}" class="visual-frame" style="${frameStyle}">${view}</div>`;
    };
    if (clip.kind === 'image') return frame(`<img ${attrs} crossorigin="anonymous" src="${src}" class="visual" style="${sourceStyle}" alt="" />`);
    const preload=options.preview&&clip.start>0?'none':'auto';
    if (clip.kind === 'audio') return `<audio ${attrs} crossorigin="anonymous" src="${src}" preload="${preload}"></audio>`;
    return frame(`<video ${attrs} crossorigin="anonymous" src="${src}" class="visual" style="${sourceStyle}" playsinline preload="${preload}"${volume === 0 ? ' muted' : ''}></video>`);
  });
  let compositionNodes = nodes.join('\n');
  if (timeline.clips.some(clip => clip.kind === 'effect')) {
    // FX tracks operate on the completed footage/text composite, independently
    // of V-track numbers. Higher FX rows wrap the accumulated lower FX layers.
    let visualStack = timeline.clips.map((clip, index) => clip.kind !== 'audio' && clip.kind !== 'effect' ? nodes[index] : '').join('');
    const adjustments = timeline.clips.map((clip, index) => ({ clip, index })).filter(({ clip }) => clip.kind === 'effect' && !isTransitionClip(clip)).sort((a, b) => trackOf(a.clip) - trackOf(b.clip) || a.index - b.index);
    for (const { clip, index } of adjustments) {
      const size = cinematicBarSettings(clip).size * 100;
      const bars = clip.effectPreset === 'cinematic-bars' ? `<div class="cinematic-bars"><div id="clip-${index}-bar-top" class="cinematic-bar top" style="height:${size}%"></div><div id="clip-${index}-bar-bottom" class="cinematic-bar bottom" style="height:${size}%"></div></div>` : '';
      const solid = clip.effectPreset === 'solid-color' ? '<div class="solid-color-rectangle"></div>' : '';
      visualStack = `<div id="clip-${index}-motion" data-effect-clip="${escapeHtml(clip.id)}" class="adjustment-layer" style="z-index:${trackOf(clip) * 256 - 1}">${visualStack}${bars}${solid}</div>`;
    }
    compositionNodes = visualStack + timeline.clips.map((clip, index) => clip.kind === 'audio' ? nodes[index] : '').join('');
  }
  const safeDuration = Math.max(duration, 1 / fps);
  const gsapUrl = mediaUrl(options.gsapUrl ?? '/vendor/gsap.min.js');
  const visualEffectsUrl = mediaUrl(options.visualEffectsUrl ?? (/^https?:/i.test(options.gsapUrl ?? '') ? new URL('/vendor/visual-effects.js', options.gsapUrl).href : '/vendor/visual-effects.js'));
  const remotionTextUrl = mediaUrl(options.remotionTextUrl ?? (/^https?:/i.test(options.gsapUrl ?? '') ? new URL('/vendor/remotion-text.js', options.gsapUrl).href : '/vendor/remotion-text.js'));
  const remotionTransitionsUrl = mediaUrl(options.remotionTransitionsUrl ?? (/^https?:/i.test(options.gsapUrl ?? '') ? new URL('/vendor/remotion-transitions.js', options.gsapUrl).href : '/vendor/remotion-transitions.js'));
  const textSources = JSON.stringify(textLayerSources(timeline.clips, fps, resolution)).replace(/</g, '\\u003c');
  const hasText=timeline.clips.some(clip=>clip.kind==='caption'||clip.kind==='graphic');
  const sharedRuntimeUrl=options.remotionRuntimeUrl||!options.remotionTextUrl&&!options.remotionTransitionsUrl?mediaUrl(options.remotionRuntimeUrl??(/^https?:/i.test(options.gsapUrl??'')?new URL('/vendor/remotion-runtime.js',options.gsapUrl).href:'/vendor/remotion-runtime.js')):undefined;
  const sceneScripts=sharedRuntimeUrl?(hasText||transitions.length?`<script src="${sharedRuntimeUrl}"></script>`:''):`${hasText?`<script src="${remotionTextUrl}"></script>`:''}${transitions.length?`<script src="${remotionTransitionsUrl}"></script>`:''}`;
  const defaultFontUrl = /^https?:/i.test(options.gsapUrl ?? '') ? new URL('/fonts/space-grotesk-latin.woff2', options.gsapUrl).href : '/fonts/space-grotesk-latin.woff2';
  const fontUrl = mediaUrl(options.fontUrl ?? defaultFontUrl);
  const fontUrls = Object.fromEntries(TEXT_FONTS.map(font => [font.id, mediaUrl(options.fontUrls?.[font.id] ?? (font.id === 'space-grotesk' ? fontUrl : /^https?:/i.test(options.gsapUrl ?? '') ? new URL(`/fonts/${font.fileName}`,options.gsapUrl).href : `/fonts/${font.fileName}`))]));
  const rawFontUrls = Object.fromEntries(TEXT_FONTS.map(font => [font.id, options.fontUrls?.[font.id] ?? (font.id === 'space-grotesk' ? options.fontUrl ?? defaultFontUrl : /^https?:/i.test(options.gsapUrl ?? '') ? new URL(`/fonts/${font.fileName}`, options.gsapUrl).href : `/fonts/${font.fileName}`)]));
  const sceneRuntimeUrl = options.sceneRuntimeUrl ?? (/^https?:/i.test(options.gsapUrl ?? '') ? new URL('/vendor/scene-runtime.js', options.gsapUrl).href : '/vendor/scene-runtime.js');
  mediaUrl(sceneRuntimeUrl);
  // Reserve runtime ownership before GSAP becomes discoverable. Otherwise a
  // late runtime leaves HyperFrames controlling its cached direct-GSAP adapter.
  const previewRuntimeBridge=options.preview?'<script>window.__player=window.__player||{};</script>':'';
  // Fully transparent video is throttled by Chromium at clip activation. A
  // small nonzero opacity keeps preview decoding active under its effect canvas.
  return `<!doctype html><html${options.preview?' data-revline-media-loading="managed"':''}><head><meta charset="utf-8">${options.preview?`<meta name="hyperframes-studio-preview" content="true"><script>
function reportPreviewError(error,label){const message=String(error&&error.message||error).replace(/([?&]token=)[^\\s'"<>]+/g,'$1[redacted]');parent.postMessage({source:'revline-preview-error',message,label},parent.location.origin);}
window.addEventListener('error',event=>{if(event.error)reportPreviewError(event.error,'uncaught');});
window.addEventListener('unhandledrejection',event=>reportPreviewError(event.reason,'unhandled promise'));
window.__hf=window.__hf||{};window.__hf.onSwallowed=event=>reportPreviewError(event.error,event.label);
</script>`:''}<meta name="viewport" content="width=device-width,initial-scale=1"><style>
${textFontFaceCss(fontUrls)}
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#000;font-family:'Space Grotesk',Arial,Helvetica,sans-serif}*{box-sizing:border-box}#composition{isolation:isolate;position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#000}.visual-frame{position:absolute;width:${width}px;height:${height}px;overflow:hidden;transform-origin:center}.motion-frame{width:100%;height:100%;transform-origin:center}.text-motion{display:inline-block}.source-window{position:absolute;overflow:hidden}.visual{position:absolute}.overlay{position:absolute;max-width:90%;width:max-content;transform:translate(-50%,-50%);font-weight:700;line-height:1.12;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere}.text-content{display:inline-block;padding:${10 * scale}px ${18 * scale}px;border-radius:${8 * scale}px}.caption{text-shadow:0 2px 12px #0009}audio{position:absolute}
.adjustment-layer,.solid-color-layer{position:absolute;inset:0;transform-origin:center;pointer-events:none}
.scene-layer{position:absolute;inset:0;overflow:hidden;pointer-events:none;visibility:hidden}.scene-frame{position:absolute;left:0;top:0;border:0;background:transparent;color-scheme:normal;transform-origin:0 0;pointer-events:none}
[data-revline-effects]{opacity:0!important}${options.preview?'video[data-revline-effects]{opacity:0.001!important}':''}.visual-effect-output{position:absolute;pointer-events:none}.solid-color-rectangle{position:absolute;z-index:2147483647;pointer-events:none;transform-origin:center}
.cinematic-bars{position:absolute;inset:0;overflow:hidden;z-index:2147483647;pointer-events:none}.cinematic-bar{position:absolute;left:0;right:0;background:#000}.cinematic-bar.top{top:0;transform:translateY(-100%)}.cinematic-bar.bottom{bottom:0;transform:translateY(100%)}
</style>${sharedRuntimeUrl?`<meta name="revline-remotion-runtime" content="${sharedRuntimeUrl}">`:''}${previewRuntimeBridge}<script src="${gsapUrl}"></script><script src="${visualEffectsUrl}"></script>${sceneScripts}</head><body><div id="composition" data-composition-id="revline" data-duration="${safeDuration}" data-width="${width}" data-height="${height}" data-fps="${fps}">${compositionNodes}</div><script>
const timeline=gsap.timeline({paused:true});
${animation.join('\n')}
window.__revlineDurationTween=gsap.to({},{duration:${safeDuration},paused:true});timeline.add(window.__revlineDurationTween,0);window.__revlineDurationTween.paused(false);
window.__timelines=window.__timelines||{};window.__timelines.revline=timeline;
${visualEffectsRuntimeScript(timeline.clips.flatMap((clip, index) => clip.kind === 'video' || clip.kind === 'image' ? [{ id: `clip-${index}`, ...visualEffectsOf(clip), cameraGlideBlur:cameraGlideBlurSource(clip) }] : []), fps, resolution)}
window.__revlineVisualEffects.installAdjustmentLayers(${JSON.stringify(adjustmentSources(timeline.clips)).replace(/</g, '\\u003c')});
window.__revlineVisualEffects.installSolidColorLayers(${JSON.stringify(solidColorSources(timeline.clips)).replace(/</g, '\\u003c')});
if(window.__revlineVisualEffects.installVisualFades)window.__revlineVisualEffects.installVisualFades(${JSON.stringify(timeline.clips.filter(clip=>clip.kind==='video'||clip.kind==='image').map(({id,kind,start,duration,visualFade,visualFadeTiming})=>({id,kind,start,duration,sourceStart:0,visualFade,visualFadeTiming}))).replace(/</g, '\\u003c')},${timeline.fps});${timeline.clips.some(clip=>(clip.visualFade?.fadeIn??0)>0||(clip.visualFade?.fadeOut??0)>0)?"else throw new Error('Visual fade renderer failed to load.');":''}
if(window.__revlineRemotionText)window.__revlineTextLayerController=window.__revlineRemotionText.installTextLayers(${textSources});${hasText?"else throw new Error('Text renderer failed to load.');":''}
${sceneRuntimeScript(sceneLayerSources(timeline, resolution), sceneFonts(rawFontUrls), sceneRuntimeUrl)}
${transitions.length ? `if(window.__revlineRemotionTransitions)window.__revlineRemotionTransitions.installTransitions(${JSON.stringify(transitions).replace(/</g, '\\u003c')},${timeline.fps});else throw new Error('Transition renderer failed to load.');` : ''}
document.querySelectorAll('video,audio').forEach(media=>{media.volume=Math.min(1,Number(media.dataset.volume));media.preservesPitch=true;});
</script></body></html>`;
}
