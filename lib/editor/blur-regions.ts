import { BLUR_REGION_MODES, DEFAULT_TRANSFORM, type BlurRegion, type Clip } from './types';
import { calculateVisualRect } from './visual-source-geometry';
import { sourceSpanOf, timelineSpanOf } from './playback-rate';

/**
 * Region blur: rectangles of a video clip's own frame that are blurred or pixelated, for hiding emails,
 * faces or number plates. A region is part of the clip's look, so it follows every framing, move and
 * split of the clip; a freeze-frame still made from it keeps the regions over its frame. The browser draws it as the first passes of the clip's effect canvas
 * (visual-effects-runtime.ts), which preview and browser export share; the fast export draws the same
 * rectangles with FFmpeg (plain-export.ts, lib/server/plain-export-render.ts). Both size the blur and the
 * pixel blocks from the helpers here, so the three renderers agree.
 */

export const MAX_BLUR_REGIONS = 8;
export const BLUR_REGION_STRENGTH: readonly [number, number] = [1, 100];
export const DEFAULT_BLUR_REGION_STRENGTH = 60;
/** Smallest side, as a fraction of the source frame: a line of small text in a 1080p screen recording. */
export const MIN_BLUR_REGION_SIZE = .005;

/** Gaussian standard deviation of a blur region, in design pixels (1080p output), measured on the clip's own layout. */
export function blurRegionSigma(strength: number) { return strength * .3; }
/** Side of one pixelate block, in design pixels (1080p output), measured on the clip's own layout. */
export function blurRegionBlock(strength: number) { return Math.max(3, strength * .6); }

/**
 * Whole pixelate blocks across and down a region. The blocks divide the region exactly, so every renderer
 * draws the same grid. `displayWidth`/`displayHeight` are the clip's full source frame as laid out on the
 * composition before its transform (calculateVisualRect), at `resolution` (the output's short side).
 */
export function pixelateBlocks(region: Pick<BlurRegion, 'width' | 'height' | 'strength'>, displayWidth: number, displayHeight: number, resolution: number) {
  const block = blurRegionBlock(region.strength) * resolution / 1080;
  return { columns: Math.max(1, Math.round(region.width * displayWidth / block)), rows: Math.max(1, Math.round(region.height * displayHeight / block)) };
}

/** Whether a region shows at this source time of the clip's media; its range is half-open. */
export function blurRegionActive(region: Pick<BlurRegion, 'start' | 'end'>, sourceTime: number) {
  return (region.start === undefined || sourceTime >= region.start - 1e-6) && (region.end === undefined || sourceTime < region.end - 1e-6);
}

type RegionClock = Pick<Clip, 'sourceStart' | 'playbackRate' | 'speedRamp'>;
/** The source second a clip shows at this clip-local second (speed and ramps included). */
export function regionSourceTime(clip: RegionClock, local: number) { return clip.sourceStart + sourceSpanOf(clip, local); }
/** The clip-local second at which a clip shows this source second. */
export function regionLocalTime(clip: RegionClock, source: number) { return timelineSpanOf(clip, source - clip.sourceStart); }

export function validateBlurRegions(clip: Pick<Clip, 'kind' | 'blurRegions'>) {
  const regions = clip.blurRegions;
  if (regions === undefined) return;
  // Video clips take regions from the editor and tools; a freeze-frame still keeps the ones over its frame.
  if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Blur regions apply to video clips.');
  if (!Array.isArray(regions) || !regions.length) throw new Error('Remove blurRegions instead of saving an empty list.');
  if (regions.length > MAX_BLUR_REGIONS) throw new Error(`A clip holds at most ${MAX_BLUR_REGIONS} blur regions.`);
  for (const region of regions) {
    const { x, y, width, height, strength, start, end } = region;
    if (![x, y, width, height, strength].every(Number.isFinite)) throw new Error('A blur region needs finite numbers.');
    if (x < 0 || y < 0 || width < MIN_BLUR_REGION_SIZE || height < MIN_BLUR_REGION_SIZE || x + width > 1 + 1e-6 || y + height > 1 + 1e-6) throw new Error(`A blur region must lie inside the frame (x, y, width, height as 0..1 fractions; each side at least ${MIN_BLUR_REGION_SIZE}).`);
    if (!BLUR_REGION_MODES.includes(region.mode)) throw new Error('A blur region mode is blur or pixelate.');
    if (strength < BLUR_REGION_STRENGTH[0] || strength > BLUR_REGION_STRENGTH[1]) throw new Error(`Blur region strength must be between ${BLUR_REGION_STRENGTH[0]} and ${BLUR_REGION_STRENGTH[1]}.`);
    if (start !== undefined && !Number.isFinite(start)) throw new Error('A blur region start must be a number.');
    if (end !== undefined && !Number.isFinite(end)) throw new Error('A blur region end must be a number.');
    if (start !== undefined && end !== undefined && end <= start) throw new Error('A blur region must end after it starts.');
  }
}

/** A region clamped into the frame, with stored fields only. */
export function normalizeBlurRegion(region: BlurRegion): BlurRegion {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const width = clamp(region.width, MIN_BLUR_REGION_SIZE, 1), height = clamp(region.height, MIN_BLUR_REGION_SIZE, 1);
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  return {
    x: round(clamp(region.x, 0, 1 - width)), y: round(clamp(region.y, 0, 1 - height)), width: round(width), height: round(height),
    mode: region.mode, strength: Math.round(clamp(region.strength, BLUR_REGION_STRENGTH[0], BLUR_REGION_STRENGTH[1])),
    ...region.start !== undefined ? { start: round(region.start) } : {}, ...region.end !== undefined ? { end: round(region.end) } : {},
  };
}


/**
 * A rectangle given as fractions of the rendered output frame (what a frame read shows), as fractions of the
 * clip's source frame, through its framing, crop and static position and scale. Refuses a rotated or flipped
 * clip, where an output rectangle is not a source rectangle; motion keyframes and follow crop are not applied.
 */
export function frameRectToSource(rect: { x: number; y: number; width: number; height: number }, clip: Pick<Clip, 'crop' | 'fit' | 'transform' | 'flip'>, source: { width?: number; height?: number }, canvas: { width: number; height: number }) {
  if (!(source.width! > 0 && source.height! > 0)) throw new Error('The clip\'s source size is unknown; give the region in source coordinates.');
  const transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  if (Math.abs(((transform.rotation % 360) + 360) % 360) > 1e-6 || clip.flip?.horizontal || clip.flip?.vertical) throw new Error('This clip is rotated or flipped; give the region in source coordinates.');
  const laid = calculateVisualRect(source.width!, source.height!, canvas.width, canvas.height, clip.crop, undefined, clip.fit ?? 'cover');
  const toSourceX = (fraction: number) => ((canvas.width / 2 + (fraction * canvas.width - (transform.x - .5) * canvas.width - canvas.width / 2) / transform.scale) - laid.left) / laid.width;
  const toSourceY = (fraction: number) => ((canvas.height / 2 + (fraction * canvas.height - (transform.y - .5) * canvas.height - canvas.height / 2) / transform.scale) - laid.top) / laid.height;
  const left = Math.max(0, toSourceX(rect.x)), top = Math.max(0, toSourceY(rect.y)), right = Math.min(1, toSourceX(rect.x + rect.width)), bottom = Math.min(1, toSourceY(rect.y + rect.height));
  if (!(right - left >= MIN_BLUR_REGION_SIZE && bottom - top >= MIN_BLUR_REGION_SIZE)) throw new Error('That rectangle does not cover this clip\'s picture in the frame.');
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Whether a region can be drawn in output-frame coordinates on this clip (frameRectToSource refuses the rest). */
export function frameMappable(clip: Pick<Clip, 'transform' | 'flip'>) {
  const rotation = clip.transform?.rotation ?? 0;
  return Math.abs(((rotation % 360) + 360) % 360) <= 1e-6 && !clip.flip?.horizontal && !clip.flip?.vertical;
}

/** A source-frame rectangle where it shows on the output frame (fractions), through the clip's static framing. */
export function sourceRectToFrame(rect: { x: number; y: number; width: number; height: number }, clip: Pick<Clip, 'crop' | 'fit' | 'transform'>, source: { width: number; height: number }, canvas: { width: number; height: number }) {
  const transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const laid = calculateVisualRect(source.width, source.height, canvas.width, canvas.height, clip.crop, undefined, clip.fit ?? 'cover');
  const toFrameX = (fraction: number) => ((transform.x - .5) * canvas.width + canvas.width / 2 + transform.scale * (laid.left + fraction * laid.width - canvas.width / 2)) / canvas.width;
  const toFrameY = (fraction: number) => ((transform.y - .5) * canvas.height + canvas.height / 2 + transform.scale * (laid.top + fraction * laid.height - canvas.height / 2)) / canvas.height;
  const x = toFrameX(rect.x), y = toFrameY(rect.y);
  return { x, y, width: toFrameX(rect.x + rect.width) - x, height: toFrameY(rect.y + rect.height) - y };
}

export type RegionHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
/** Move or resize a rectangle (fractions of its bounds) by a pointer delta in the same fractions, kept inside 0..1. */
export function dragRegionRect(initial: { x: number; y: number; width: number; height: number }, handle: RegionHandle, dx: number, dy: number, minimum = .01) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  if (handle === 'move') return { ...initial, x: clamp(initial.x + dx, 0, 1 - initial.width), y: clamp(initial.y + dy, 0, 1 - initial.height) };
  let left = initial.x, top = initial.y, right = initial.x + initial.width, bottom = initial.y + initial.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minimum);
  if (handle.includes('e')) right = clamp(right + dx, left + minimum, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minimum);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minimum, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
