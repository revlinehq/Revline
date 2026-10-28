/**
 * Color finishing on video/image clips: RGB/master curves, 8-band HSL, and 3D LUTs (built-in looks or a
 * parsed .cube). Applied in the clip's WebGL pass after the basic grade, identically in preview and export.
 */
/** [input, output] pairs within 0..1. */
export type CurvePoints = number[][];
export type ColorCurves = { master?: CurvePoints; red?: CurvePoints; green?: CurvePoints; blue?: CurvePoints };
export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type HslBand = typeof HSL_BANDS[number];
/** hue in degrees (-60..60), saturation and luminance -1..1. */
export type HslShift = { hue: number; saturation: number; luminance: number };
export type HslAdjust = Partial<Record<HslBand, HslShift>>;
export const LUT_LOOKS = ['teal-orange', 'film-warm', 'bleach-bypass', 'mono-contrast', 'cool-night', 'vintage-fade', 'golden-hour', 'pastel'] as const;
export type LutLook = typeof LUT_LOOKS[number];
/** look: a built-in name, or "custom:<id>" of a LUT stored on the timeline. */
export type ClipLut = { look: string; amount: number };
export type TimelineLut = { id: string; name: string; size: number; data: string };
export const MAX_TIMELINE_LUTS = 4, CUSTOM_LUT_SIZE = 17;
const HUE_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300];

export function validateColorFinish(clip: { kind: string; colorCurves?: ColorCurves; hsl?: HslAdjust; lut?: ClipLut }, luts?: TimelineLut[]) {
  if (!clip.colorCurves && !clip.hsl && !clip.lut) return;
  if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Curves, HSL and LUTs apply to video or image clips.');
  for (const [channel, points] of Object.entries(clip.colorCurves ?? {})) {
    if (!['master', 'red', 'green', 'blue'].includes(channel)) throw new Error(`Unknown curve ${channel}.`);
    if (!Array.isArray(points) || points.length < 2 || points.length > 16) throw new Error(`The ${channel} curve needs 2 to 16 points.`);
    points.forEach((point, index) => {
      if (point.length !== 2 || point.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error(`Curve points are [input, output] within 0..1.`);
      if (index > 0 && point[0] <= points[index - 1][0]) throw new Error(`The ${channel} curve needs increasing inputs.`);
    });
  }
  for (const [band, shift] of Object.entries(clip.hsl ?? {})) {
    if (!(HSL_BANDS as readonly string[]).includes(band)) throw new Error(`Unknown HSL band ${band}. Use ${HSL_BANDS.join(', ')}.`);
    if (!shift || !Number.isFinite(shift.hue) || Math.abs(shift.hue) > 60 || !Number.isFinite(shift.saturation) || Math.abs(shift.saturation) > 1 || !Number.isFinite(shift.luminance) || Math.abs(shift.luminance) > 1) throw new Error('HSL hue is -60..60 degrees; saturation and luminance are -1..1.');
  }
  if (clip.lut) {
    if (!Number.isFinite(clip.lut.amount) || clip.lut.amount < 0 || clip.lut.amount > 1) throw new Error('LUT amount must be between 0 and 1.');
    const custom = clip.lut.look.startsWith('custom:');
    if (!custom && !(LUT_LOOKS as readonly string[]).includes(clip.lut.look)) throw new Error(`Choose a LUT look: ${LUT_LOOKS.join(', ')}, or a custom LUT.`);
    if (custom && luts && !luts.some(lut => `custom:${lut.id}` === clip.lut!.look)) throw new Error('This custom LUT is not stored on the timeline.');
  }
}

export function validateTimelineLuts(luts?: TimelineLut[]) {
  if (!luts) return;
  if (luts.length > MAX_TIMELINE_LUTS) throw new Error(`A timeline keeps up to ${MAX_TIMELINE_LUTS} custom LUTs.`);
  for (const lut of luts) if (!lut.id || lut.size !== CUSTOM_LUT_SIZE || typeof lut.data !== 'string' || lut.data.length !== Math.ceil(lut.size ** 3 * 3 / 3) * 4) throw new Error('Custom LUT data is invalid.');
}

/** Monotone cubic interpolation of curve points into 256 values (Fritsch-Carlson, so no overshoot). */
export function curveTable(points?: CurvePoints) {
  const table = new Uint8Array(256);
  if (!points?.length) { for (let i = 0; i < 256; i++) table[i] = i; return table; }
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]), n = points.length;
  const slopes = xs.slice(0, -1).map((x, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - x || 1e-6));
  const tangents = xs.map((_, i) => i === 0 ? slopes[0] : i === n - 1 ? slopes[n - 2] : slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) { tangents[i] = tangents[i + 1] = 0; continue; }
    const a = tangents[i] / slopes[i], b = tangents[i + 1] / slopes[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); tangents[i] = t * a * slopes[i]; tangents[i + 1] = t * b * slopes[i]; }
  }
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let y: number;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      const k = xs.findIndex((value, index) => index < n - 1 && x >= value && x <= xs[index + 1]), h = xs[k + 1] - xs[k], t = (x - xs[k]) / h;
      y = (2 * t ** 3 - 3 * t ** 2 + 1) * ys[k] + (t ** 3 - 2 * t ** 2 + t) * h * tangents[k] + (-2 * t ** 3 + 3 * t ** 2) * ys[k + 1] + (t ** 3 - t ** 2) * h * tangents[k + 1];
    }
    table[i] = Math.round(Math.min(1, Math.max(0, y)) * 255);
  }
  return table;
}

/** RGBA rows for the shader: red, green, blue curves and the master curve. */
export function curvesTexture(curves: ColorCurves) {
  const red = curveTable(curves.red), green = curveTable(curves.green), blue = curveTable(curves.blue), master = curveTable(curves.master), out = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) { out[i * 4] = red[i]; out[i * 4 + 1] = green[i]; out[i * 4 + 2] = blue[i]; out[i * 4 + 3] = master[i]; }
  return out;
}

export function hslUniform(hsl: HslAdjust) {
  return new Float32Array(HSL_BANDS.flatMap(band => { const shift = hsl[band]; return [(shift?.hue ?? 0) / 360, shift?.saturation ?? 0, shift?.luminance ?? 0]; }));
}
export const HSL_CENTERS = HUE_CENTERS;

const luma = (r: number, g: number, b: number) => .2126 * r + .7152 * g + .0722 * b;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const sCurve = (value: number, amount: number) => clamp01(value + amount * (value - .5) * (1 - Math.abs(2 * value - 1)) * 2);
/** Built-in looks as color functions, sampled into 3D LUTs. */
const LOOKS: Record<LutLook, (r: number, g: number, b: number) => [number, number, number]> = {
  'teal-orange': (r, g, b) => { const l = luma(r, g, b), w = clamp01((l - .35) * 2.2); return [sCurve(r * (1 - .12 * (1 - w)) + .1 * w, .25), sCurve(g * (1 + .02 * (1 - w)) + .02 * w, .2), sCurve(b * (1 + .14 * (1 - w)) - .1 * w, .25)]; },
  'film-warm': (r, g, b) => [sCurve(.04 + r * .95 + .03, .18), sCurve(.03 + g * .93 + .01, .15), sCurve(.05 + b * .82, .12)],
  'bleach-bypass': (r, g, b) => { const l = luma(r, g, b); return [sCurve(r * .45 + l * .55, .45), sCurve(g * .45 + l * .55, .45), sCurve(b * .45 + l * .55, .45)]; },
  'mono-contrast': (r, g, b) => { const l = sCurve(luma(r, g, b), .5); return [l, l, l]; },
  'cool-night': (r, g, b) => { const l = luma(r, g, b); return [sCurve(r * .78 + l * .05, .2) * .92, sCurve(g * .88 + l * .06, .2) * .95, clamp01(sCurve(b * 1.05 + .05, .2))]; },
  'vintage-fade': (r, g, b) => [clamp01(.08 + r * .84 + .02), clamp01(.07 + g * .8), clamp01(.12 + b * .7)],
  'golden-hour': (r, g, b) => { const l = luma(r, g, b); return [clamp01(r * 1.08 + .04 * l + .02), clamp01(g * 1.0 + .02 * l), clamp01(b * .82)]; },
  pastel: (r, g, b) => { const l = luma(r, g, b); return [clamp01(.12 + (r * .7 + l * .3) * .86), clamp01(.12 + (g * .7 + l * .3) * .86), clamp01(.14 + (b * .7 + l * .3) * .84)]; },
};

/** A LUT as RGBA atlas rows: x = blue slice * size + red, y = green. */
export function lutAtlas(size: number, sample: (r: number, g: number, b: number) => [number, number, number]) {
  const out = new Uint8Array(size * size * size * 4);
  for (let g = 0; g < size; g++) for (let b = 0; b < size; b++) for (let r = 0; r < size; r++) {
    const [ro, go, bo] = sample(r / (size - 1), g / (size - 1), b / (size - 1)), offset = (g * size * size + b * size + r) * 4;
    out[offset] = Math.round(clamp01(ro) * 255); out[offset + 1] = Math.round(clamp01(go) * 255); out[offset + 2] = Math.round(clamp01(bo) * 255); out[offset + 3] = 255;
  }
  return out;
}
export const lookAtlas = (look: LutLook, size = 17) => lutAtlas(size, LOOKS[look]);
/** Stored custom LUTs are size^3 RGB bytes in .cube order (red fastest, then green, then blue). */
export function customAtlas(lut: Pick<TimelineLut, 'size' | 'data'>) {
  const binary = atob(lut.data), n = lut.size;
  return lutAtlas(n, (r, g, b) => { const index = (Math.round(b * (n - 1)) * n * n + Math.round(g * (n - 1)) * n + Math.round(r * (n - 1))) * 3; return [binary.charCodeAt(index) / 255, binary.charCodeAt(index + 1) / 255, binary.charCodeAt(index + 2) / 255]; });
}

/** Parse a .cube file and resample it to a 17-point LUT (trilinear), as base64 RGB bytes. */
export function parseCube(text: string): { size: number; data: string } {
  let size = 0, domainMin = [0, 0, 0], domainMax = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('TITLE')) continue;
    if (line.startsWith('LUT_1D_SIZE')) throw new Error('This is a 1D LUT; use a 3D .cube LUT.');
    if (line.startsWith('LUT_3D_SIZE')) { size = Number(line.split(/\s+/)[1]); continue; }
    if (line.startsWith('DOMAIN_MIN')) { domainMin = line.split(/\s+/).slice(1).map(Number); continue; }
    if (line.startsWith('DOMAIN_MAX')) { domainMax = line.split(/\s+/).slice(1).map(Number); continue; }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) values.push(...parts);
  }
  if (!Number.isInteger(size) || size < 2 || size > 65) throw new Error('The .cube file needs a LUT_3D_SIZE between 2 and 65.');
  if (values.length !== size ** 3 * 3) throw new Error(`The .cube file should list ${size ** 3} colors; it lists ${values.length / 3}.`);
  const norm = (value: number, axis: number) => clamp01((value - domainMin[axis]) / ((domainMax[axis] - domainMin[axis]) || 1));
  const at = (r: number, g: number, b: number, channel: number) => norm(values[((b * size + g) * size + r) * 3 + channel], channel);
  const n = CUSTOM_LUT_SIZE;
  let binary = '';
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const fr = r / (n - 1) * (size - 1), fg = g / (n - 1) * (size - 1), fb = b / (n - 1) * (size - 1);
    const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb), r1 = Math.min(size - 1, r0 + 1), g1 = Math.min(size - 1, g0 + 1), b1 = Math.min(size - 1, b0 + 1), dr = fr - r0, dg = fg - g0, db = fb - b0;
    for (let channel = 0; channel < 3; channel++) {
      const c00 = at(r0, g0, b0, channel) * (1 - dr) + at(r1, g0, b0, channel) * dr, c10 = at(r0, g1, b0, channel) * (1 - dr) + at(r1, g1, b0, channel) * dr;
      const c01 = at(r0, g0, b1, channel) * (1 - dr) + at(r1, g0, b1, channel) * dr, c11 = at(r0, g1, b1, channel) * (1 - dr) + at(r1, g1, b1, channel) * dr;
      binary += String.fromCharCode(Math.round(((c00 * (1 - dg) + c10 * dg) * (1 - db) + (c01 * (1 - dg) + c11 * dg) * db) * 255));
    }
  }
  return { size: n, data: btoa(binary) };
}

/** What the runtime needs for one clip: curve rows, HSL uniforms and the LUT atlas source. */
export type ColorFinishSource = { curves?: ColorCurves; hsl?: HslAdjust; lut?: { amount: number; look?: LutLook; custom?: Pick<TimelineLut, 'size' | 'data'> } };
export function colorFinishSource(clip: { colorCurves?: ColorCurves; hsl?: HslAdjust; lut?: ClipLut }, luts?: TimelineLut[]): ColorFinishSource | undefined {
  if (!clip.colorCurves && !clip.hsl && !clip.lut) return undefined;
  const custom = clip.lut?.look.startsWith('custom:') ? luts?.find(lut => `custom:${lut.id}` === clip.lut!.look) : undefined;
  return {
    ...(clip.colorCurves ? { curves: clip.colorCurves } : {}), ...(clip.hsl ? { hsl: clip.hsl } : {}),
    ...(clip.lut && clip.lut.amount > 0 && (custom || !clip.lut.look.startsWith('custom:')) ? { lut: { amount: clip.lut.amount, ...(custom ? { custom: { size: custom.size, data: custom.data } } : { look: clip.lut.look as LutLook }) } } : {}),
  };
}
