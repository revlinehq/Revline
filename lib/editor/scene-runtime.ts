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
import { SCENE_GSAP_PLUGINS, type SceneGsapPlugin } from './scene-modules';
import { sceneBrandContext, type SceneBrand, type SceneBrandContext } from './brand-kit';

type Init = { type: 'init'; code: string; brand: SceneBrand | null; media?: { name: string; type: string; data: ArrayBuffer }[]; icons?: Record<string, string>; blueprints?: { name: string; code: string }[]; width: number; height: number; fps: number; duration: number; fonts: { family: string; weight: string; data: ArrayBuffer }[] };
type Seek = { type: 'seek'; time: number; seq: number };
/** What a scene's default export receives. Time 0 on `tl` is the first frame of the clip. */
export type SceneContext = { root: HTMLElement; tl: gsap.core.Timeline; gsap: typeof gsap; width: number; height: number; duration: number; fps: number; brand: SceneBrandContext | null; /** Project images and videos by name, as URLs for <img src>, <video src> or CSS backgrounds. */ media: Record<string, string>; /** A Lucide icon as SVG markup, e.g. icon('scissors', { size: 16, color: '#8d8f93' }). */ icon: (name: string, options?: IconOptions) => string; /** Builds a brand kit blueprint (its whole UI) inside container at width x height and returns its root; its pieces are [data-part=...] elements to animate. */ blueprint: (name: string, container: HTMLElement, size?: { width: number; height: number }) => HTMLElement };
export type IconOptions = { size?: number; color?: string; strokeWidth?: number; fill?: string };

const PLUGINS: Record<SceneGsapPlugin, object> = { CustomEase, CustomWiggle, CustomBounce, SplitText, DrawSVGPlugin, MorphSVGPlugin, MotionPathPlugin, ScrambleTextPlugin, TextPlugin };
gsap.registerPlugin(...Object.values(PLUGINS), ExpoScaleEase, RoughEase, SlowMo);

const gsapModule = { gsap, default: gsap, ...PLUGINS, ExpoScaleEase, RoughEase, SlowMo };
const MODULES: Record<string, unknown> = {
  gsap: gsapModule, 'gsap/all': gsapModule, 'gsap/EasePack': { ExpoScaleEase, RoughEase, SlowMo },
  ...Object.fromEntries(SCENE_GSAP_PLUGINS.map(name => [`gsap/${name}`, { [name]: PLUGINS[name], default: PLUGINS[name] }])),
};

/** Lucide icons render like lucide-react: a 24-unit stroked SVG at the requested size. */
function iconFactory(icons: Record<string, string>) {
  return (name: string, { size = 24, color = 'currentColor', strokeWidth = 2, fill = 'none' }: IconOptions = {}) => {
    const body = icons[name];
    if (body === undefined) throw new Error(`Unknown icon "${name}". Use a Lucide icon name in kebab-case, like 'scissors' or 'chevron-down'.`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" style="display:block">${body}</svg>`;
  };
}

function post(message: Record<string, unknown>) { window.parent.postMessage({ source: 'revline-scene', ...message }, '*'); }

/** Compile a scene module. It may import only gsap and its bundled plugins. */
export function compileScene(code: string): (context: SceneContext) => unknown {
  const compiled = transform(code, { transforms: ['typescript', 'imports'], production: true }).code;
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => { if (!(name in MODULES)) throw new Error(`Scenes can import only gsap and its plugins, not "${name}".`); return MODULES[name]; };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  const scene = module.exports.default;
  if (typeof scene !== 'function') throw new Error('A scene must export default a function that builds it.');
  return scene as (context: SceneContext) => unknown;
}

/** Videos in a scene follow the scene clock: data-start (scene seconds it begins), data-offset (source seconds), data-rate, data-loop. */
function syncVideos(time: number, fps: number) {
  return Array.from(document.querySelectorAll('video')).map(video => {
    video.muted = true; video.pause();
    const ready = video.readyState >= 1 ? Promise.resolve() : new Promise<void>(resolve => video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
    return ready.then(() => {
      const length = video.duration || 0, rate = Number(video.dataset.rate) || 1;
      let target = Math.max(0, time - (Number(video.dataset.start) || 0)) * rate + (Number(video.dataset.offset) || 0);
      if (length > 0) target = video.hasAttribute('data-loop') ? target % length : Math.min(target, Math.max(0, length - 0.5 / fps));
      if (Math.abs(video.currentTime - target) < 0.25 / fps && video.readyState >= 2) return;
      return new Promise<void>(resolve => { const done = () => resolve(); video.addEventListener('seeked', done, { once: true }); setTimeout(done, 5000); video.currentTime = target; });
    }).catch(() => undefined);
  });
}

if (typeof window !== 'undefined' && window.parent !== window) {
  const root = document.getElementById('scene-root')!;
  let master: gsap.core.Timeline | null = null, origin = 0, failed = false, fps = 30;
  const fail = (message: string) => { if (failed) return; failed = true; post({ type: 'error', message }); };
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
    origin = gsap.globalTimeline.time();
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
      void compileScene(found.code)({ root: host, tl: gsap.timeline(), gsap, width, height, duration: data.duration, fps: data.fps, brand, media, icon, blueprint });
      return host;
    };
    await scene({ root, tl: gsap.timeline(), gsap, width: data.width, height: data.height, duration: data.duration, fps: data.fps, brand, media, icon, blueprint });
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
      void build(data).then(() => post({ type: 'compiled' }), error => fail(error instanceof Error ? error.message : String(error)));
    } else if (data.type === 'seek') {
      try { master?.seek(origin + data.time, false); } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
      const images = Array.from(document.images).filter(image => !image.complete).map(image => image.decode().catch(() => undefined));
      void Promise.all([document.fonts.ready, ...images, ...syncVideos(data.time, fps)]).then(() => post({ type: 'painted', seq: data.seq }));
    }
  });
  post({ type: 'ready' });
}
