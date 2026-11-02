import { z } from 'zod';
import type { Clip } from './types';

export const IMPACT_PRESETS = ['invert', 'black-white', 'posterize', 'manga'] as const;
export const OVERLAY_PRESETS = ['light-leak', 'film-burn', 'lens-flare', 'dust', 'grain'] as const;
export const OVERLAY_BLENDS = ['screen', 'add', 'overlay'] as const;
export const impactSettingsSchema = z.object({
  preset: z.enum(IMPACT_PRESETS), intensity: z.number().min(0).max(1),
  threshold: z.number().min(.05).max(.95), levels: z.number().int().min(2).max(8),
  speedLines: z.number().min(0).max(1), flash: z.number().min(0).max(1),
  centerX: z.number().min(0).max(1), centerY: z.number().min(0).max(1),
}).strict();
export const overlaySettingsSchema = z.object({
  preset: z.enum(OVERLAY_PRESETS), blend: z.enum(OVERLAY_BLENDS), intensity: z.number().min(0).max(1),
  color: z.string().regex(/^#[\da-f]{6}$/i), seed: z.number().int().min(0).max(65535), speed: z.number().min(0).max(4),
  fade: z.number().min(0).max(.5),
}).strict();
export const parallaxSettingsSchema = z.object({
  duration: z.number().min(.2).max(10), amount: z.number().min(0).max(.12),
  panX: z.number().min(-1).max(1), panY: z.number().min(-1).max(1),
  orbit: z.number().min(-8).max(8), zoom: z.number().min(1).max(1.3),
}).strict();
export type ImpactSettings = z.infer<typeof impactSettingsSchema>;
export type OverlaySettings = z.infer<typeof overlaySettingsSchema>;
export type ParallaxSettings = z.infer<typeof parallaxSettingsSchema>;
export const DEFAULT_IMPACT: ImpactSettings = { preset: 'manga', intensity: 1, threshold: .5, levels: 3, speedLines: .35, flash: 0, centerX: .5, centerY: .5 };
export const DEFAULT_OVERLAY: OverlaySettings = { preset: 'light-leak', blend: 'screen', intensity: .65, color: '#ff803e', seed: 17, speed: 1, fade: .25 };
export const DEFAULT_PARALLAX: ParallaxSettings = { duration: 2, amount: .035, panX: .7, panY: -.2, orbit: 2, zoom: 1.08 };

export function validateMontageVfx(clip: Clip) {
  if (clip.impact !== undefined) {
    if (clip.kind !== 'effect' || clip.effectPreset !== 'impact-frame') throw new Error('Impact settings belong to an impact-frame FX clip.');
    impactSettingsSchema.parse(clip.impact);
  }
  if (clip.overlay !== undefined) {
    if (clip.kind !== 'effect' || clip.effectPreset !== 'texture-overlay') throw new Error('Overlay settings belong to a texture-overlay FX clip.');
    overlaySettingsSchema.parse(clip.overlay);
  }
  if (clip.overlayTiming && (clip.effectPreset !== 'texture-overlay' || !Number.isFinite(clip.overlayTiming.duration) || clip.overlayTiming.duration <= 0 || !Number.isFinite(clip.overlayTiming.offset))) throw new Error('Overlay timing needs its original duration and a finite offset.');
  if (clip.parallax !== undefined) {
    if (clip.kind !== 'image') throw new Error('Parallax needs a prepared freeze-frame atlas.');
    parallaxSettingsSchema.parse(clip.parallax);
  }
}

/** Duration input and timeline placement share the project's frame grid. */
export function vfxDuration(fps: number, frames?: number, duration?: number) {
  if ((frames === undefined) === (duration === undefined)) throw new Error('Choose frames or duration, never both.');
  const count = frames ?? Math.round(duration! * fps);
  if (!Number.isInteger(count) || count < 1 || count > fps * 30) throw new Error('Choose one frame up to 30 seconds.');
  return count / fps;
}

/** Original procedural pack. No source assets, downloads or third-party texture licenses. */
export function drawTextureOverlay(canvas: HTMLCanvasElement, settings: OverlaySettings, time: number, duration: number, fps: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Texture overlay canvas is unavailable.');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (time < 0 || time >= duration) return;
  const progress = time / duration, fade = settings.fade;
  const envelope = fade === 0 ? 1 : Math.min(1, progress / fade, (1 - progress) / fade);
  canvas.style.opacity = String(settings.intensity * Math.max(0, envelope));
  canvas.style.mixBlendMode = settings.blend === 'add' ? 'plus-lighter' : settings.blend;
  const tick = Math.floor((time * settings.speed + 1e-6) * fps);
  let state = (settings.seed + tick * 7919) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const glow = (x: number, y: number, radius: number, color: string, strength: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(.13, color); gradient.addColorStop(1, `${color}00`);
    ctx.globalAlpha = strength; ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  };
  ctx.globalAlpha = 1;
  if (settings.preset === 'light-leak' || settings.preset === 'film-burn') {
    const phase = time * settings.speed;
    const burn = settings.preset === 'film-burn';
    glow(w * (.05 + .12 * Math.sin(phase * 2.1 + settings.seed)), h * (.5 + .3 * Math.cos(phase)), w * (burn ? .95 : .65), settings.color, burn ? .9 : .65);
    glow(w * (.95 - .1 * Math.cos(phase * 1.7)), h * .6, w * .5, '#ffcc69', .4);
    if (burn) glow(w * progress, h * .5, w * .8, '#fff3cb', Math.sin(progress * Math.PI) ** 3);
  } else if (settings.preset === 'lens-flare') {
    const x = w * (.15 + .7 * progress), y = h * (.4 + .08 * Math.sin(time * settings.speed));
    glow(x, y, w * .22, settings.color, .85);
    ctx.globalAlpha = .55;
    const streak = ctx.createLinearGradient(0, 0, w, 0);
    streak.addColorStop(0, `${settings.color}00`); streak.addColorStop(.5, settings.color); streak.addColorStop(1, `${settings.color}00`);
    ctx.fillStyle = streak; ctx.fillRect(0, y - h * .002, w, h * .004);
    for (let i = 1; i <= 5; i++) glow(w / 2 + (w / 2 - x) * i * .25, h / 2 + (h / 2 - y) * i * .25, w * (.015 + i * .008), settings.color, .07);
  } else if (settings.preset === 'dust') {
    ctx.fillStyle = settings.color;
    for (let i = 0; i < 100; i++) { ctx.globalAlpha = .15 + random() * .6; ctx.beginPath(); ctx.ellipse(random() * w, random() * h, (1 + random() * 3) * h / 1080, (1 + random() * 4) * h / 1080, random() * Math.PI, 0, Math.PI * 2); ctx.fill(); }
  } else {
    // A small noise tile repeats at output-pixel scale; deterministic at every seek.
    const tile = document.createElement('canvas'); tile.width = tile.height = 128;
    const tileContext = tile.getContext('2d')!;
    const data = tileContext.createImageData(128, 128);
    for (let i = 0; i < data.data.length; i += 4) { const value = Math.floor(random() * 256); data.data[i] = data.data[i + 1] = data.data[i + 2] = value; data.data[i + 3] = settings.blend === 'overlay' ? 100 : 35; }
    tileContext.putImageData(data, 0, 0); ctx.fillStyle = ctx.createPattern(tile, 'repeat')!; ctx.fillRect(0, 0, w, h);
  }
  ctx.globalAlpha = 1;
}
