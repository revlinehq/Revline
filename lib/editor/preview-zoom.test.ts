import { expect, test } from 'vitest';
import { PREVIEW_ZOOM_STEP, clampPreviewScale, fitPreviewView, normalizePreviewWheel, panPreviewBy, previewViewGeometry, projectPreviewBounds, zoomPreviewAt } from './preview-zoom';
import { resizeText } from './text-transforms';

const canvas = { width: 1920, height: 1080 };
const viewport = { width: 1000, height: 600, padding: 20 };
const center = { x: 960, y: 540 };

test.each([
  { width: 1080, height: 1920 },
  { width: 1920, height: 1080 },
  { width: 1440, height: 960 },
])('magnification scales the complete $width by $height composition in project pixels', size => {
  const panel = { width: 582, height: 259, padding: 18 };
  const fitted = previewViewGeometry(fitPreviewView(size), size, panel);
  for (const scale of [.1, .25, .5, 1, 1.5, 2]) {
    const zoomed = previewViewGeometry({ scale, center: { x: size.width / 2, y: size.height / 2 } }, size, panel);
    expect(zoomed.width).toBe(size.width * scale);
    expect(zoomed.height).toBe(size.height * scale);
    expect(zoomed.width / zoomed.height).toBeCloseTo(size.width / size.height);
    expect(zoomed.layoutWidth).toBe(fitted.layoutWidth);
    expect(zoomed.layoutHeight).toBe(fitted.layoutHeight);
    expect(zoomed.layoutWidth * zoomed.sceneScale).toBeCloseTo(zoomed.width);
    expect(zoomed.layoutHeight * zoomed.sceneScale).toBeCloseTo(zoomed.height);
  }
});

test('Fit centers the complete composition and reserves room for selection handles', () => {
  const geometry = previewViewGeometry(fitPreviewView(canvas), canvas, viewport);
  expect(geometry.scale).toBe(.5);
  expect(geometry.fitScale).toBe(.5);
  expect(geometry.left).toBe(20);
  expect(geometry.top).toBe(30);
  expect(geometry.canPan).toBe(false);
});

test('100% uses project pixels while Fit computes the magnification for the monitor', () => {
  const geometry = previewViewGeometry({ scale: 1, center }, canvas, viewport);
  const fitted = previewViewGeometry(fitPreviewView(canvas), canvas, viewport);
  expect(geometry.width).toBe(1920);
  expect(geometry.height).toBe(1080);
  expect(geometry.layoutWidth).toBe(fitted.layoutWidth);
  expect(geometry.layoutHeight).toBe(fitted.layoutHeight);
  expect(geometry.sceneScale).toBe(2);
  expect(geometry.canPan).toBe(true);
});

test('zooming out from a Fit below 25% makes the entire frame smaller', () => {
  const portrait = { width: 1080, height: 1920 };
  const panel = { width: 582, height: 259, padding: 18 };
  const view = fitPreviewView(portrait);
  const before = previewViewGeometry(view, portrait, panel);
  expect(before.scale).toBeLessThan(.25);
  const next = zoomPreviewAt(view, portrait, panel, before.scale / PREVIEW_ZOOM_STEP, { x: panel.width / 2, y: panel.height / 2 });
  const after = previewViewGeometry(next, portrait, panel);
  expect(after.scale).toBeCloseTo(before.scale / PREVIEW_ZOOM_STEP);
  expect(after.width).toBeCloseTo(before.width / PREVIEW_ZOOM_STEP);
  expect(after.height).toBeCloseTo(before.height / PREVIEW_ZOOM_STEP);
  expect(after.canPan).toBe(false);
});

test('zoom keeps the same composition point under an off-center cursor', () => {
  const anchor = { x: 620, y: 350 };
  const initial = { scale: 1, center };
  const next = zoomPreviewAt(initial, canvas, viewport, 2, anchor);
  const before = previewViewGeometry(initial, canvas, viewport);
  const after = previewViewGeometry(next, canvas, viewport);
  expect((anchor.x - before.left) / before.renderScale).toBeCloseTo((anchor.x - after.left) / after.renderScale);
  expect((anchor.y - before.top) / before.renderScale).toBeCloseTo((anchor.y - after.top) / after.renderScale);
});

test('a moving pinch midpoint translates the same logical anchor while zooming', () => {
  const anchor = { x: 550, y: 320 }, moved = { x: 610, y: 350 };
  const initial = { scale: 1, center };
  const next = zoomPreviewAt(initial, canvas, viewport, 1.5, anchor, moved);
  const before = previewViewGeometry(initial, canvas, viewport), after = previewViewGeometry(next, canvas, viewport);
  expect((anchor.x - before.left) / before.renderScale).toBeCloseTo((moved.x - after.left) / after.renderScale);
  expect((anchor.y - before.top) / before.renderScale).toBeCloseTo((moved.y - after.top) / after.renderScale);
});

test('panning is bounded so the zoomed image cannot disappear from the viewport', () => {
  const next = panPreviewBy({ scale: 2, center }, canvas, viewport, { x: 10000, y: -10000 });
  const geometry = previewViewGeometry(next, canvas, viewport);
  expect(geometry.left).toBe(20);
  expect(geometry.top + geometry.height).toBe(viewport.height - viewport.padding);
});

test('Fit discards old zoom and pan even after resizing the viewport', () => {
  const view = fitPreviewView(canvas);
  expect(panPreviewBy(view, canvas, viewport, { x: 500, y: 500 })).toBe(view);
  const smaller = previewViewGeometry(view, canvas, { width: 400, height: 300, padding: 12 });
  expect(smaller.left).toBeCloseTo(12);
  expect(smaller.center).toEqual(center);
  expect(smaller.canPan).toBe(false);
});

test('zoom has finite bounds while every listed preset remains reachable on a small viewport', () => {
  expect(clampPreviewScale(Infinity)).toBe(1);
  expect(clampPreviewScale(0)).toBe(.01);
  expect(clampPreviewScale(100)).toBe(4);
  expect(clampPreviewScale(2)).toBe(2);
});

test('panel resizing preserves explicit magnification and recomputes Fit', () => {
  const smaller = { width: 400, height: 300, padding: 12 };
  const geometry = previewViewGeometry({ scale: 1.5, center }, canvas, smaller);
  expect(geometry.scale).toBe(1.5);
  expect(geometry.width).toBe(2880);
  expect(geometry.height).toBe(1620);
  expect(previewViewGeometry(fitPreviewView(canvas), canvas, smaller).width).toBe(376);
  expect(geometry.canPan).toBe(true);
});

test('pan moves the complete portrait frame in screen pixels without resizing it', () => {
  const portrait = { width: 1080, height: 1920 }, panel = { width: 582, height: 259, padding: 18 };
  const view = { scale: 2, center: { x: 540, y: 960 } };
  const before = previewViewGeometry(view, portrait, panel);
  const after = previewViewGeometry(panPreviewBy(view, portrait, panel, { x: 12, y: 20 }), portrait, panel);
  expect(after.left - before.left).toBeCloseTo(12);
  expect(after.top - before.top).toBeCloseTo(20);
  expect([after.width, after.height]).toEqual([before.width, before.height]);
});

test('text bounds stay in layout pixels while resize gestures use magnified screen pixels', () => {
  const composition = { left: 0, top: 0, width: 1920, height: 1080 };
  const painted = { left: 480, top: 432, width: 480, height: 108 };
  const layout = { width: 480, height: 270 };
  const local = projectPreviewBounds(painted, composition, layout);
  expect(local).toEqual({ left: 120, top: 108, width: 120, height: 27 });
  const screen = projectPreviewBounds(local, { left: 0, top: 0, ...layout }, { width: 960, height: 540 });
  expect(screen).toEqual({ left: 240, top: 216, width: 240, height: 54 });
  const initial = { x: .5, y: .5, fontSize: 52 };
  expect(resizeText(initial, 'se', 20, 20, screen.width, screen.height, 960, 540)).toEqual(resizeText(initial, 'se', 10, 10, local.width, local.height, 480, 270));
});

test('wheel input normalizes pixel, line, and page scrolling', () => {
  expect(normalizePreviewWheel(2, 0, 600)).toBe(2);
  expect(normalizePreviewWheel(2, 1, 600)).toBe(32);
  expect(normalizePreviewWheel(2, 2, 600)).toBe(1200);
  expect(normalizePreviewWheel(NaN, 0, 600)).toBe(0);
});
