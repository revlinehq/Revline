import { roundTo } from '../math';
import type { ColorCurves, CurvePoints } from './color-finish';

/** Color measured from one source frame by the media worker (percentiles at 2, 10, 25, 50, 75, 90, 98%). */
export type ColorStats = { time: number; percentiles: { red: number[]; green: number[]; blue: number[]; luma: number[] }; saturation: number; cast: { warmth: number; tint: number }; dominant: { hex: string; share: number }[] };

const average = (rows: number[][]) => rows[0].map((_, index) => rows.reduce((sum, row) => sum + row[index], 0) / rows.length);

function colorName(hex: string) {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max - min < .08) return l < .15 ? 'black' : l > .85 ? 'white' : l < .45 ? 'dark gray' : 'gray';
  const d = max - min, hue = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const name = hue < 15 ? 'red' : hue < 40 ? 'orange' : hue < 65 ? 'yellow' : hue < 160 ? 'green' : hue < 200 ? 'teal' : hue < 250 ? 'blue' : hue < 290 ? 'purple' : hue < 335 ? 'magenta' : 'red';
  return `${l < .3 ? 'dark ' : l > .75 ? 'light ' : ''}${name}${(max - min) / (1 - Math.abs(2 * l - 1) || 1) < .3 ? ' (muted)' : ''}`;
}

/** A readable summary of measured frames, with a neutralizing grade suggestion. */
export function describeColor(stats: ColorStats[]) {
  const luma = average(stats.map(item => item.percentiles.luma)), warmth = average(stats.map(item => [item.cast.warmth]))[0], tint = average(stats.map(item => [item.cast.tint]))[0];
  const saturation = average(stats.map(item => [item.saturation]))[0], median = luma[3], range = luma[6] - luma[0];
  // Merge near-identical colors measured in different frames.
  const merged: { rgb: number[]; share: number }[] = [];
  for (const item of stats.flatMap(entry => entry.dominant)) {
    const rgb = [1, 3, 5].map(index => parseInt(item.hex.slice(index, index + 2), 16) / 255);
    const near = merged.find(entry => Math.hypot(...entry.rgb.map((value, index) => value - rgb[index])) < .12);
    if (near) { near.rgb = near.rgb.map((value, index) => (value * near.share + rgb[index] * item.share) / (near.share + item.share)); near.share += item.share; }
    else merged.push({ rgb, share: item.share });
  }
  const dominant = merged.sort((a, b) => b.share - a.share).slice(0, 5).map(item => { const hex = `#${item.rgb.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`; return { hex, name: colorName(hex), share: roundTo(item.share / stats.length, 2) }; });
  const notes: string[] = [];
  if (warmth > .06) notes.push(`Warm ${warmth > .14 ? 'orange' : 'amber'} cast from the light (red over blue by ${roundTo(warmth * 100, 0)}%).`);
  if (warmth < -.06) notes.push(`Cool blue cast (blue over red by ${roundTo(-warmth * 100, 0)}%).`);
  if (tint > .04) notes.push('Green tint (fluorescent or LED light).');
  if (tint < -.04) notes.push('Magenta tint.');
  if (median < .28) notes.push('Underexposed: the midtones sit low.');
  if (median > .68) notes.push('Bright, possibly overexposed midtones.');
  if (luma[6] > .985) notes.push('Highlights clip to white.');
  if (luma[0] < .01) notes.push('Shadows crush to black.');
  if (range < .55) notes.push('Flat, low contrast (log-like or hazy).');
  if (saturation < .15) notes.push('Muted, low saturation.');
  if (saturation > .5) notes.push('Very saturated.');
  return {
    exposure: { median: roundTo(median, 3), shadows: roundTo(luma[0], 3), highlights: roundTo(luma[6], 3), contrastRange: roundTo(range, 3) },
    saturation: roundTo(saturation, 3), cast: { warmth: roundTo(warmth, 3), tint: roundTo(tint, 3) }, dominant, notes,
    // Neutral midtones and a 0.45 median: a starting point, not a creative look.
    suggestedGrade: { exposure: roundTo(Math.max(-1.5, Math.min(1.5, Math.log2(.45 / Math.max(.05, median)))), 2), temperature: Math.round(Math.max(-60, Math.min(60, -warmth * 260))), tint: Math.round(Math.max(-40, Math.min(40, -tint * 300))), contrast: roundTo(range < .55 ? 1.15 : 1, 2), saturation: roundTo(saturation < .15 ? 1.15 : 1, 2) },
  };
}

/** Per-channel curves that map the target's measured percentiles onto the reference's (histogram matching). */
export function matchCurves(target: ColorStats[], reference: ColorStats[], strength = 1): ColorCurves {
  const curve = (channel: 'red' | 'green' | 'blue'): CurvePoints => {
    const from = average(target.map(item => item.percentiles[channel])), to = average(reference.map(item => item.percentiles[channel]));
    const points: CurvePoints = [];
    const push = (x: number, y: number) => { y = x + (y - x) * strength; if (!points.length || x > points[points.length - 1][0] + .02) points.push([roundTo(Math.min(1, Math.max(0, x)), 3), roundTo(Math.min(1, Math.max(0, y)), 3)]); };
    // Ends extend the outermost mapping so blacks and whites move with the measured tones.
    push(0, Math.max(0, to[0] - from[0]));
    from.forEach((value, index) => { if (value > .01 && value < .99) push(value, to[index]); });
    push(1, Math.min(1, 1 - (from[6] - to[6])));
    if (points.length < 2) return [[0, 0], [1, 1]];
    // Keep outputs non-decreasing so the curve never inverts tones.
    for (let index = 1; index < points.length; index++) points[index][1] = Math.max(points[index][1], points[index - 1][1]);
    return points;
  };
  return { red: curve('red'), green: curve('green'), blue: curve('blue') };
}
