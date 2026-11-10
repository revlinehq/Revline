import { updateLiveAdjustmentEffects } from './live-adjustment-effects';
import { updateLiveMediaContent } from './live-media-content';
import { updateLiveTextEffects } from './live-preview-effects';
import { updateLiveVisualEffects } from './live-visual-effects';
import { updateLiveVisualGeometry } from './live-visual-geometry';
import { expandBackgroundFills } from './mirror-blur-layout';
import type { MediaAsset, Timeline } from './types';

type LiveUpdater = (document: Document, previous: Timeline, next: Timeline, assets: MediaAsset[]) => boolean;

/**
 * Every live updater, in the order they run. Media content goes first because it may replace media nodes the
 * others locate; the rest drive separate controllers (adjustment layers, text, WebGL effects, frame geometry), so their relative order does not change the result.
 */
const LIVE_UPDATERS: readonly LiveUpdater[] = [
  updateLiveMediaContent,
  updateLiveAdjustmentEffects,
  updateLiveTextEffects,
  updateLiveVisualEffects,
  updateLiveVisualGeometry,
];

/**
 * Bring a rendered composition from `previous` to `next` in place. Returns false when some part needs a
 * rebuilt composition. By default it stops at the first such part; `continueAfterFailure` still applies the rest.
 */
export function updateLivePreview(document: Document, previous: Timeline, next: Timeline, assets: MediaAsset[], { continueAfterFailure = false } = {}): boolean {
  // The composition renders backgroundFill bands as extra nodes; every updater sees them the same way.
  previous = expandBackgroundFills(previous, assets);
  next = expandBackgroundFills(next, assets);
  let retained = true;
  for (const update of LIVE_UPDATERS) {
    if (!retained && !continueAfterFailure) break;
    retained = update(document, previous, next, assets) && retained;
  }
  return retained;
}
