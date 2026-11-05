// Adapted from OpenCut's preview-viewport.tsx and zoom.ts.
// MIT attribution: OpenCut-LICENSE.
export const PREVIEW_ZOOM_PRESETS = [25, 50, 100, 150, 200] as const;
export const PREVIEW_ZOOM_STEP = 1.25;
export const PREVIEW_ZOOM_MIN = .01;
export const PREVIEW_ZOOM_MAX = 4;
export type PreviewPoint = { x: number; y: number };
export type PreviewSize = { width: number; height: number };
export type PreviewBounds = PreviewSize & { left: number; top: number };
export type PreviewViewportSize = PreviewSize & { padding: number };
export type PreviewView = { scale: number | null; center: PreviewPoint };

export function fitPreviewView(canvas: PreviewSize): PreviewView {
  return { scale: null, center: { x: canvas.width / 2, y: canvas.height / 2 } };
}

function previewFitScale(canvas: PreviewSize, viewport: PreviewViewportSize) {
  if (canvas.width <= 0 || canvas.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(Math.max(1, viewport.width - 2 * viewport.padding) / canvas.width, Math.max(1, viewport.height - 2 * viewport.padding) / canvas.height);
}

function clampPreviewScale(scale: number) {
  return Math.max(PREVIEW_ZOOM_MIN, Math.min(PREVIEW_ZOOM_MAX, Number.isFinite(scale) ? scale : 1));
}

function clampCenterAxis(center: number, size: number, visibleSize: number, scale: number) {
  const half = Math.max(1, visibleSize) / (2 * scale);
  if (half >= size / 2) return Math.max(size - half, Math.min(half, center));
  return Math.max(half, Math.min(size - half, center));
}

export function previewViewGeometry(view: PreviewView, canvas: PreviewSize, viewport: PreviewViewportSize) {
  const fitScale = previewFitScale(canvas, viewport);
  // Percentages describe project pixels. Keep the player's fitted layout stable
  // while scaling the complete composition, including its frame and overlays.
  const scale = view.scale === null ? fitScale : clampPreviewScale(view.scale);
  const width = canvas.width * scale, height = canvas.height * scale;
  const visibleWidth = Math.max(1, viewport.width - 2 * viewport.padding);
  const visibleHeight = Math.max(1, viewport.height - 2 * viewport.padding);
  const center = {
    x: clampCenterAxis(view.center.x, canvas.width, visibleWidth, scale),
    y: clampCenterAxis(view.center.y, canvas.height, visibleHeight, scale),
  };
  return {
    fitScale, scale, renderScale: scale, center, width, height,
    layoutWidth: canvas.width * fitScale,
    layoutHeight: canvas.height * fitScale,
    sceneScale: scale / fitScale,
    left: viewport.width / 2 - center.x * scale,
    top: viewport.height / 2 - center.y * scale,
    canPan: width > visibleWidth + .000001 || height > visibleHeight + .000001,
  };
}

/** Keep the same composition point under the cursor, except at a pan limit. */
export function zoomPreviewAt(view: PreviewView, canvas: PreviewSize, viewport: PreviewViewportSize, requestedScale: number, anchor: PreviewPoint, nextAnchor = anchor): PreviewView {
  const current = previewViewGeometry(view, canvas, viewport);
  const scale = clampPreviewScale(requestedScale), renderScale = scale;
  const point = { x: current.center.x + (anchor.x - viewport.width / 2) / current.renderScale, y: current.center.y + (anchor.y - viewport.height / 2) / current.renderScale };
  const next = { scale, center: { x: point.x - (nextAnchor.x - viewport.width / 2) / renderScale, y: point.y - (nextAnchor.y - viewport.height / 2) / renderScale } };
  return { scale, center: previewViewGeometry(next, canvas, viewport).center };
}

/** Delta describes movement of the displayed image, in screen pixels. */
export function panPreviewBy(view: PreviewView, canvas: PreviewSize, viewport: PreviewViewportSize, delta: PreviewPoint): PreviewView {
  const current = previewViewGeometry(view, canvas, viewport);
  if (!current.canPan) return view;
  const next = { scale: view.scale, center: { x: current.center.x - delta.x / current.renderScale, y: current.center.y - delta.y / current.renderScale } };
  return { ...next, center: previewViewGeometry(next, canvas, viewport).center };
}

/** Map a painted rectangle to local layout pixels, or local pixels to screen pixels. */
export function projectPreviewBounds(bounds: PreviewBounds, from: PreviewBounds, to: PreviewSize): PreviewBounds {
  return {
    left: (bounds.left - from.left) / from.width * to.width,
    top: (bounds.top - from.top) / from.height * to.height,
    width: bounds.width / from.width * to.width,
    height: bounds.height / from.height * to.height,
  };
}

export function normalizePreviewWheel(delta: number, mode: number, pageSize: number) {
  if (!Number.isFinite(delta)) return 0;
  return delta * (mode === 1 ? 16 : mode === 2 ? pageSize : 1);
}
