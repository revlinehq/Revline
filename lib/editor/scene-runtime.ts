// Runs inside each scene's sandboxed frame (opaque origin, no network). A scene is a
// TypeScript module that builds plain HTML once and choreographs it on a GSAP
// timeline. The composition then sends clip-local times; the frame seeks every
// animation the scene made to that exact time and acknowledges once fonts and
// images are ready.
import { transform } from 'sucrase';
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { CustomWiggle } from 'gsap/CustomWiggle';
import { CustomBounce } from 'gsap/CustomBounce';
import { ExpoScaleEase, RoughEase, SlowMo } from 'gsap/EasePack';
import { SplitText } from 'gsap/SplitText';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { TextPlugin } from 'gsap/TextPlugin';
import { assertSceneImport, SCENE_GSAP_PLUGINS, sceneTransformOptions, splitExportDeclarations, type SceneGsapPlugin, type SceneRuntimeModules } from './scene-modules';
import { sceneBrandContext, type SceneBrand, type SceneBrandContext } from './brand-kit';
import { createTextMotion, type TextMotion } from './scene-text-motion';
import { motionHelpers, type MotionHelpers } from './scene-motion';
import type { SceneBeats } from './types';
import { whipHelper, type WhipHelper } from './scene-whip';

type Init = { type: 'init'; code: string; brand: SceneBrand | null; media?: { name: string; type: string; data: ArrayBuffer }[]; icons?: Record<string, string>; blueprints?: { name: string; code: string }[]; beats?: SceneBeats | null; width: number; height: number; fps: number; duration: number; fonts: { family: string; weight: string; data: ArrayBuffer }[] };
/** `playing` is set while the editor preview plays: videos then run on their own decoders instead of being seeked every frame. */
type Seek = { type: 'seek'; time: number; seq: number; playing?: boolean };
/** What a scene's default export receives. Time 0 on `tl` is the first frame of the clip. */
export type SceneContext = { root: HTMLElement; tl: gsap.core.Timeline; gsap: typeof gsap; width: number; height: number; duration: number; fps: number; brand: SceneBrandContext | null; /** Project images, videos and GLB models by name, as URLs for <img src>, <video src> or CSS backgrounds. */ media: Record<string, string>; /** A Lucide icon as SVG markup, e.g. icon('scissors', { size: 16, color: '#8d8f93' }). */ icon: (name: string, options?: IconOptions) => string; /** Builds a brand kit blueprint (its whole UI) inside container at width x height and returns its root; its pieces are [data-part=...] elements to animate. */ blueprint: (name: string, container: HTMLElement, size?: { width: number; height: number }) => HTMLElement; /** A named part of a film: build(tl) gets a timeline placed on the film's at `start` film seconds, timed in section seconds (0 = its start). start and duration are number literals in the code. */ section: SectionHelper } & TextMotion & MotionHelpers & { /** A 3–6 frame whip between two shots (launch-films-motions page shot-changes): whip(tl, { out, in, at, direction }). On a section's tl, at is in section seconds; it may straddle the section's end. */ whip: WhipHelper };
export type SectionHelper = (name: string, start: number, duration: number, build: (tl: gsap.core.Timeline) => void) => gsap.core.Timeline;

/**
 * The section() a scene receives. Each call nests a timeline on the film's at its start, so the section's tweens run at
 * film time; the engine reads the call's literal start and duration to know which code the section owns, so a section
 * may not animate past its own end, start inside another, or nest.
 */
function sectionHelper(film: gsap.core.Timeline, fps: number, starts: WeakMap<gsap.core.Timeline, number>): SectionHelper {
  let building: string | undefined;
  return (name, start, duration, build) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('section(name, start, duration, build) needs a name.');
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0) throw new Error(`Section "${name}" needs a start of 0 or more and a positive duration, in film seconds.`);
    if (typeof build !== 'function') throw new Error(`Section "${name}" needs a build function: section('${name}', ${start}, ${duration}, (tl) => { ... }).`);
    if (building !== undefined) throw new Error(`Section "${name}" is inside section "${building}". Sections do not nest: call section() from the scene's own function.`);
    const tl = gsap.timeline();
    starts.set(tl, start);
    building = name;
    try { build(tl); } finally { building = undefined; }
    if (tl.duration() > duration + 1 / fps + 1e-3) throw new Error(`Section "${name}" animates for ${Math.round(tl.duration() * 1000) / 1000}s but lasts ${duration}s. Keep its tweens inside its duration, or put a move that spans sections on the scene's own tl.`);
    film.add(tl, start);
    return tl;
  };
}
/**
 * section(), the text functions (reveal, exit, swap, counter, type, mark) and the motion helpers (lib/editor/scene-motion)
 * for one scene or blueprint. Text functions add their moves to the timeline being built: a section's while its build
 * runs, otherwise the scene's tl.
 */
function sceneHelpers(film: gsap.core.Timeline, root: HTMLElement, data: { fps: number; width: number; height: number; duration: number; beats?: SceneBeats | null }) {
  const active: gsap.core.Timeline[] = [];
  const text = createTextMotion({ root, fps: data.fps, timeline: () => active[active.length - 1] ?? film });
  // whip() reads a section's film start from its timeline, so a whip called inside a section may straddle its end.
  const starts = new WeakMap<gsap.core.Timeline, number>();
  const sections = sectionHelper(film, data.fps, starts);
  const section: SectionHelper = (name, start, duration, build) => sections(name, start, duration, inner => {
    active.push(inner);
    try { build(inner); } finally { active.pop(); }
  });
  return { section, ...text, ...motionHelpers({ root, fps: data.fps, width: data.width, height: data.height, section, beats: data.beats }), whip: whipHelper(gsap, film, starts, root, data.width, data.height, data.fps, data.duration) };
}

export type IconOptions = { size?: number; color?: string; strokeWidth?: number; fill?: string };

const PLUGINS: Record<SceneGsapPlugin, object> = { CustomEase, CustomWiggle, CustomBounce, SplitText, DrawSVGPlugin, MorphSVGPlugin, MotionPathPlugin, ScrambleTextPlugin, TextPlugin };
gsap.registerPlugin(...Object.values(PLUGINS), ExpoScaleEase, RoughEase, SlowMo);

// Marked as ES modules so a compiled `import gsap from 'gsap'` reads `default` (gsap itself), not the whole module.
const gsapModule = { __esModule: true, gsap, default: gsap, ...PLUGINS, ExpoScaleEase, RoughEase, SlowMo };
const MODULES = {
  gsap: gsapModule, 'gsap/all': gsapModule, 'gsap/EasePack': { ExpoScaleEase, RoughEase, SlowMo },
  ...Object.fromEntries(SCENE_GSAP_PLUGINS.map(name => [`gsap/${name}`, { __esModule: true, [name]: PLUGINS[name], default: PLUGINS[name] }])) as Record<`gsap/${SceneGsapPlugin}`, object>,
} satisfies SceneRuntimeModules<'gsap'>;

/** Lucide icons render like lucide-react: a 24-unit stroked SVG at the requested size. */
function iconFactory(icons: Record<string, string>) {
  return (name: string, { size = 24, color = 'currentColor', strokeWidth = 2, fill = 'none' }: IconOptions = {}) => {
    const body = icons[name];
    if (body === undefined) throw new Error(`Unknown icon "${name}". Use a Lucide icon name in kebab-case, like 'scissors' or 'chevron-down'.`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" style="display:block">${body}</svg>`;
  };
}

function post(message: Record<string, unknown>) { window.parent.postMessage({ source: 'revline-scene', ...message }, '*'); }

/** Compile a scene module and return its default export. Scenes import only gsap and its plugins. */
export function compileScene(code: string): (context: SceneContext) => unknown {
  const compiled = transform(splitExportDeclarations(code), sceneTransformOptions).code;
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    assertSceneImport(name);
    if (!Object.hasOwn(MODULES, name)) throw new Error(`The scene renderer did not load module "${name}". Rebuild the scene bundles and restart the media worker or renderer.`);
    return MODULES[name as keyof typeof MODULES];
  };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  const scene = module.exports.default;
  if (typeof scene !== 'function') throw new Error('A scene must export default a function that builds it.');
  return scene as (context: SceneContext) => unknown;
}

/** Resolves on the first of these media events, or after `ms`. */
function mediaEvent(video: HTMLVideoElement, names: string[], ms: number) {
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); for (const name of names) video.removeEventListener(name, done); resolve(); };
    const timer = setTimeout(done, ms);
    for (const name of names) video.addEventListener(name, done);
  });
}

// A <video> composites through its own surface, which an export capture can take before the seeked
// frame reaches it: those frames showed the scene with an empty footage box. Each seeked frame is
// drawn into a canvas that stands in for the video, so the frame is part of the scene's own paint.
const stillFrames = new Map<HTMLVideoElement, HTMLCanvasElement>();
const STILL_STYLE = 'video[data-revline-still]{visibility:hidden!important}';

// A seeked event can precede the decoded frame being available to drawImage.
// Register before seeking so paused videos cannot deliver that frame first.
function decodedVideoFrame(video: HTMLVideoElement, target: number, fps: number) {
  if (!video.requestVideoFrameCallback) return Promise.resolve();
  return new Promise<void>(resolve => {
    let callback = 0;
    const done = () => { clearTimeout(timer); video.cancelVideoFrameCallback(callback); resolve(); };
    const timer = setTimeout(done, 4000);
    const frame: VideoFrameRequestCallback = (_now, metadata) => {
      if (Math.abs(metadata.mediaTime - target) <= Math.max(1 / fps, 1 / 24) + .001) done();
      else callback = video.requestVideoFrameCallback(frame);
    };
    callback = video.requestVideoFrameCallback(frame);
  });
}

function objectFitBox(fit: string, position: string, source: { width: number; height: number }, box: { width: number; height: number }) {
  let scaleX = box.width / source.width, scaleY = box.height / source.height;
  if (fit === 'cover') scaleX = scaleY = Math.max(scaleX, scaleY);
  else if (fit === 'none') scaleX = scaleY = 1;
  else if (fit === 'scale-down') scaleX = scaleY = Math.min(1, scaleX, scaleY);
  else if (fit !== 'fill') scaleX = scaleY = Math.min(scaleX, scaleY);
  const width = source.width * scaleX, height = source.height * scaleY;
  const [x = '50%', y = '50%'] = position.split(/\s+/);
  const place = (value: string, free: number) => value.endsWith('%') ? free * Number.parseFloat(value) / 100 : Number.parseFloat(value) || 0;
  return { x: place(x, box.width - width), y: place(y, box.height - height), width, height };
}

function drawStill(video: HTMLVideoElement) {
  if (!video.isConnected || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  let canvas = stillFrames.get(video);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.dataset.revlineStill = '';
    stillFrames.set(video, canvas);
    if (!document.getElementById('revline-still-style')) { const style = document.createElement('style'); style.id = 'revline-still-style'; style.textContent = STILL_STYLE; document.head.appendChild(style); }
  }
  if (canvas.previousSibling !== video) video.parentNode?.insertBefore(canvas, video.nextSibling);
  // The canvas takes the video's place and look: its classes, inline styles (GSAP tweens included) and laid-out size.
  canvas.className = video.className;
  canvas.style.cssText = video.style.cssText;
  canvas.hidden = video.hidden;
  // The hidden video retains its layout box. Overlay that box instead of
  // placing a second normal-flow box after it (outside clipped containers).
  const computed = getComputedStyle(video);
  if (computed.position !== 'absolute' && computed.position !== 'fixed') {
    Object.assign(canvas.style, { position: 'absolute', left: `${video.offsetLeft}px`, top: `${video.offsetTop}px`, margin: '0' });
  }
  const width = video.offsetWidth, height = video.offsetHeight;
  Object.assign(canvas.style, { width: `${width}px`, height: `${height}px`, boxSizing: 'border-box', pointerEvents: 'none' });
  // Rasterized at the size it is drawn on screen, so a camera zoomed into the scene keeps the footage sharp.
  const rect = video.getBoundingClientRect(), zoom = Math.max(1, width ? rect.width / width : 1, height ? rect.height / height : 1) * (window.devicePixelRatio || 1);
  const scale = Math.min(zoom, 4096 / Math.max(1, width, height)), pixelWidth = Math.max(1, Math.round(width * scale)), pixelHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  if (!context) return;
  const fit = objectFitBox(computed.objectFit, computed.objectPosition, { width: video.videoWidth, height: video.videoHeight }, { width, height });
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  context.drawImage(video, fit.x, fit.y, fit.width, fit.height);
  video.dataset.revlineStill = '';
}

/** The source second a video shows at scene time `time`. */
function videoTarget(video: HTMLVideoElement, time: number, fps: number) {
  const length = video.duration || 0, rate = Number(video.dataset.rate) || 1;
  const target = Math.max(0, time - (Number(video.dataset.start) || 0)) * rate + (Number(video.dataset.offset) || 0);
  if (length <= 0) return target;
  return video.hasAttribute('data-loop') ? target % length : Math.min(target, Math.max(0, length - 0.5 / fps));
}

// Preview playback lets each video play on its own decoder: seeking every frame waits for a decode per frame,
// which held nested footage to about two frames a second. Videos are re-seeked only when they drift.
const PLAYBACK_DRIFT = 0.15;
// A re-seek lands late on slow decoders; checking drift again before it settles would seek on every frame.
// A video whose decoder cannot keep up drifts again right after each seek, and every seek decodes from a keyframe
// again, so the wait doubles while it keeps drifting (to 4 s). A jump of the scene clock starts every wait over.
const SETTLE_MS = 600, SETTLE_MAX_MS = 4000;
let liveSeeks = new WeakMap<HTMLVideoElement, { at: number; wait: number }>(), liveTime: number | undefined;
// A video starting this soon buffers ahead, so its shot does not open on an empty decoder.
const PRELOAD_AHEAD = 2;
/**
 * Whether the scene shows this video now. Its own visibility is left out: the paused stand-in hides it with
 * visibility, so that is read from its parent; display and opacity count on the video and every ancestor.
 * Footage clipped away or moved out of frame still counts as shown.
 */
function onScreen(video: HTMLVideoElement) {
  if (!video.checkVisibility) return true;
  return video.checkVisibility({ opacityProperty: true }) && (video.parentElement?.checkVisibility({ visibilityProperty: true, opacityProperty: true }) ?? false);
}

function playVideo(video: HTMLVideoElement, time: number, fps: number) {
  video.muted = true;
  if (video.readyState < 1) return;
  const start = Number(video.dataset.start) || 0, rate = Number(video.dataset.rate) || 1, target = videoTarget(video, time, fps), length = video.duration || 0;
  const loop = video.hasAttribute('data-loop'), held = time < start || !loop && length > 0 && target >= length - 1 / fps;
  // Only videos on screen play. A film holds many videos in shots that are hidden before and after their turn;
  // playing them all (a 32 s film had 18 decoding, at most 7 of them visible) loads the browser's decoders and
  // compositor for footage nobody sees. One that has not started yet still waits on its first frame.
  const shown = onScreen(video);
  if (held || !shown) {
    if (!video.paused) video.pause();
    if (held && !video.seeking && Math.abs(video.currentTime - target) >= 0.25 / fps) video.currentTime = target;
    if (held && time >= start - PRELOAD_AHEAD && video.preload !== 'auto') video.preload = 'auto';
    if (!shown) return;
  }
  // The live video shows itself once it has a frame; its frozen stand-in returns on the next paused seek.
  if (video.readyState >= 2) {
    const canvas = stillFrames.get(video);
    if (canvas) canvas.style.display = 'none';
    delete video.dataset.revlineStill;
  }
  if (held) return;
  if (video.preload !== 'auto') video.preload = 'auto';
  video.loop = loop;
  if (video.playbackRate !== rate) video.playbackRate = rate;
  // A looping video wraps on its own, so drift is measured around the loop.
  let drift = Math.abs(video.currentTime - target);
  if (loop && length > 0) drift = Math.min(drift, length - drift);
  const now = performance.now();
  const last = liveSeeks.get(video);
  if (!video.seeking && drift > PLAYBACK_DRIFT && (!last || now - last.at > last.wait)) {
    const wait = last && now - last.at < last.wait * 2 ? Math.min(last.wait * 2, SETTLE_MAX_MS) : SETTLE_MS;
    liveSeeks.set(video, { at: now, wait });
    video.currentTime = target;
  }
  if (video.paused) void video.play().catch(() => undefined);
}

/** Videos in a scene follow the scene clock: data-start (scene seconds it begins), data-offset (source seconds), data-rate, data-loop. */
function syncVideos(time: number, fps: number, playing: boolean) {
  // A video the scene removed takes its stand-in with it.
  for (const [video, canvas] of stillFrames) if (!video.isConnected) { canvas.remove(); stillFrames.delete(video); }
  if (playing) {
    if (liveTime === undefined || Math.abs(time - liveTime) > 0.5) liveSeeks = new WeakMap();
    liveTime = time;
    document.querySelectorAll('video').forEach(video => playVideo(video, time, fps));
    return [];
  }
  liveTime = undefined;
  return Array.from(document.querySelectorAll('video')).map(video => {
    video.muted = true; video.pause();
    const ready = video.readyState >= 1 ? Promise.resolve() : mediaEvent(video, ['loadedmetadata', 'error'], 4000);
    return ready.then(async () => {
      const target = videoTarget(video, time, fps);
      if (Math.abs(video.currentTime - target) >= 0.25 / fps || video.seeking) {
        const seeked = mediaEvent(video, ['seeked', 'error'], 4000);
        const decoded = decodedVideoFrame(video, target, fps);
        video.currentTime = target;
        await Promise.all([seeked, decoded]);
      } else if (!stillFrames.has(video)) {
        // At source time zero there is no seek event. Wait for the initial
        // decoded frame before freezing it into the canvas as well.
        await decodedVideoFrame(video, target, fps);
      }
      // Seeked can land before the frame at the new time is decoded.
      if (video.readyState < 2 && !video.error) await mediaEvent(video, ['loadeddata', 'canplay', 'error'], 4000);
      drawStill(video);
    }).catch(() => undefined);
  });
}

if (typeof window !== 'undefined' && window.parent !== window) {
  const root = document.getElementById('scene-root')!;
  // The scene seeks one master timeline.
  let master: gsap.core.Timeline | null = null, origin = 0, failed = false, fps = 30;
  const fail = (error: unknown) => { if (failed) return; failed = true; post({ type: 'error', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }); };
  // Math.random would differ between preview and export; seed it before the scene builds.
  let state = 1;
  Math.random = () => { state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6D2B79F5) >>> 0; return state / 4294967296; };
  // Nothing plays on its own: the global clock stays paused and the scene's
  // animations, stray tweens included, are gathered into one seekable timeline.
  gsap.ticker.lagSmoothing(0);
  gsap.globalTimeline.pause();
  const build = async (data: Init) => {
    for (const font of data.fonts) { const face = new FontFace(font.family, font.data, { weight: font.weight }); await face.load(); document.fonts.add(face); }
    fps = data.fps;
    const media = Object.fromEntries((data.media ?? []).map(item => [item.name, URL.createObjectURL(new Blob([item.data], { type: item.type || 'image/png' }))]));
    const scene = compileScene(data.code);
    // Exactly on a zero-duration tween GSAP picks its before or after state from the direction of travel, so a
    // first seek to a clip's first frame reverted the scene's build-time gsap.set calls and showed every hidden
    // part (an export's first frame of a clip mid-timeline). Seeks land a tenth of a millisecond after it.
    origin = gsap.globalTimeline.time() + 1e-4;
    const brand = sceneBrandContext(data.brand ?? undefined), icon = iconFactory(data.icons ?? {});
    // A blueprint is itself a scene module: built once, statically, into the container the scene gives it.
    const blueprint = (name: string, container: HTMLElement, size?: { width: number; height: number }) => {
      const found = (data.blueprints ?? []).find(item => item.name.toLowerCase() === name.trim().toLowerCase());
      if (!found) throw new Error(`No blueprint "${name}" is attached to this scene. Attach it with blueprints on addScene or editScene.`);
      const width = size?.width ?? (container.clientWidth || data.width), height = size?.height ?? (container.clientHeight || data.height);
      const host = document.createElement('div');
      host.dataset.blueprint = found.name;
      host.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden`;
      container.appendChild(host);
      const tl = gsap.timeline();
      void compileScene(found.code)({ root: host, tl, gsap, width, height, duration: data.duration, fps: data.fps, brand, media, icon, blueprint, ...sceneHelpers(tl, host, { fps: data.fps, width, height, duration: data.duration, beats: data.beats }) });
      return host;
    };
    const tl = gsap.timeline();
    // Text functions measure the laid-out text while the scene builds; every face must have loaded first.
    await document.fonts.ready;
    await scene({ root, tl, gsap, width: data.width, height: data.height, duration: data.duration, fps: data.fps, brand, media, icon, blueprint, ...sceneHelpers(tl, root, data) });
    master = gsap.exportRoot({ paused: true });
    // gsap.set calls made while building land after the scene's timeline at the same start time,
    // so a first seek into the middle re-applied the starting states over the animation.
    // Re-adding every timed child puts those instant sets first; order among the rest is kept.
    for (const child of master.getChildren(false, true, true)) if (child.duration() > 0) { const at = child.startTime(); master.remove(child); master.add(child, at); }
    master.seek(origin, false);
  };
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.source !== 'revline-scene-host') return;
    const data = event.data as Init | Seek;
    if (data.type === 'init') {
      void build(data).then(() => post({ type: 'compiled' }), error => fail(error));
    } else if (data.type === 'seek') {
      // A frame that falls behind during playback gets seeks faster than it draws them. Of playing seeks still
      // waiting, only the newest is drawn and the ones it replaces are acknowledged with it, so a busy moment does
      // not leave the scene drawing old times. Paused, scrub and export seeks are each drawn at their own time.
      if (waiting && waiting.playing === true && data.playing === true) skipped.push(waiting.seq);
      else drawSeek();
      waiting = data;
      if (!scheduled) { scheduled = true; seekChannel.port2.postMessage(null); }
    }
  });
  let waiting: Seek | null = null, skipped: number[] = [], scheduled = false;
  // Usually runs after the seek messages already queued, so a backlog of playing seeks collapses into its last one.
  const seekChannel = new MessageChannel();
  seekChannel.port1.onmessage = () => { scheduled = false; drawSeek(); };
  function drawSeek() {
    const data = waiting, replaced = skipped;
    if (!data) return;
    waiting = null; skipped = [];
    try { master?.seek(origin + data.time, false); } catch (error) { fail(error); }
    const images = Array.from(document.images).filter(image => !image.complete).map(image => image.decode().catch(() => undefined));
    void Promise.all([document.fonts.ready, ...images, ...syncVideos(data.time, fps, data.playing === true)]).then(() => { for (const seq of replaced) post({ type: 'painted', seq }); post({ type: 'painted', seq: data.seq }); }, error => fail(error));
  }
  post({ type: 'ready' });
}
