import { describe, expect, test } from 'vitest';
import { calculateVisualRect } from './composition';
import { cropSelectionRect, dragSourceCrop } from './source-crop';
import { DEFAULT_CROP } from './types';

describe('direct source cropping', () => {
  test('uses full-source bounds when a landscape source fills a portrait canvas', () => {
    const source = calculateVisualRect(1920, 1080, 1080, 1920, DEFAULT_CROP, undefined, 'contain').window;
    const next = dragSourceCrop(DEFAULT_CROP, 'nw', source.width * .2, source.height * .1, source.width, source.height);
    expect(next).toEqual({ left: .2, top: .1, right: 0, bottom: 0 });
    const selection = cropSelectionRect(next, source);
    expect(selection.left).toBeCloseTo(source.left + source.width * .2);
    expect(selection.top).toBeCloseTo(source.top + source.height * .1);
    expect(selection.width / selection.height).toBeCloseTo(1920 * .8 / (1080 * .9));
  });
  test('preview zoom does not change source fractions or retained aspect', () => {
    const initial = { left: .1, top: .15, right: .2, bottom: .1 };
    const fit = dragSourceCrop(initial, 'se', 24, 12, 240, 120);
    const zoomed = dragSourceCrop(initial, 'se', 72, 36, 720, 360);
    expect(fit).toEqual(zoomed);
    expect(fit.left).toBe(initial.left); expect(fit.top).toBe(initial.top);
    expect(fit.right).toBeCloseTo(.1); expect(fit.bottom).toBe(0);
  });
  test('keeps more than five percent and produces valid preview/export geometry', () => {
    const next = dragSourceCrop({ left: .1, top: 0, right: .2, bottom: 0 }, 'nw', 9999, 9999, 1920, 1080);
    expect(next.left + next.right).toBeCloseTo(.949);
    expect(next.top + next.bottom).toBeCloseTo(.949);
    expect(() => calculateVisualRect(1920, 1080, 1080, 1920, next, undefined, 'cover')).not.toThrow();
    expect(() => calculateVisualRect(1920, 1080, 1080, 1920, next, undefined, 'contain')).not.toThrow();
    const resetEdge = dragSourceCrop(next, 'nw', -9999, -9999, 1920, 1080);
    expect(resetEdge.left).toBe(0); expect(resetEdge.top).toBe(0);
  });
  test('moving a crop retains its size and cannot leave the source', () => {
    const initial = { left: .1, top: .2, right: .3, bottom: .25 };
    const next = dragSourceCrop(initial, 'move', 9999, -9999, 1920, 1080);
    expect(next.left).toBeCloseTo(.4); expect(next.right).toBe(0);
    expect(next.top).toBe(0); expect(next.bottom).toBeCloseTo(.45);
    expect(next.left + next.right).toBeCloseTo(initial.left + initial.right);
    expect(next.top + next.bottom).toBeCloseTo(initial.top + initial.bottom);
  });
  test('invalid viewport measurements do not corrupt a crop', () => {
    expect(dragSourceCrop(DEFAULT_CROP, 'se', 10, 10, 0, 120)).toBe(DEFAULT_CROP);
    expect(dragSourceCrop(DEFAULT_CROP, 'se', NaN, 10, 240, 120)).toBe(DEFAULT_CROP);
  });
});
