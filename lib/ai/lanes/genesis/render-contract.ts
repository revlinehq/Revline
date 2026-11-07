/** Genesis compositor renders: shared by convex/genesisRenders.ts, the editor tools and the media worker. */

/** Prefix of a worker refusal (moving camera, never-uncovered area, untrackable surface). Refused renders are not retried. */
export const GENESIS_REFUSAL = 'Genesis refused: ';
/** Prefix of an allowance refusal (monthly paid-eraser seconds used up). Not sticky: the same request can run next month. */
export const GENESIS_ALLOWANCE = 'Genesis allowance: ';

export type CleanPlateParams = { dilate?: number };
export type SurfaceParams = { time: number; corners?: [number, number][]; rotate?: 0 | 90 | 180 | 270; fit: 'cover' | 'stretch'; lightMatch: boolean };

/** One identity per distinct request: the same op, footage, layers, insert, range and parameters reuse one render. */
export function renderKey(input: { op: string; sourceAssetId: string; layerIds: string[]; seedLayerId?: string; insertAssetId?: string; start: number; end: number; fps: number; params: unknown }) {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return JSON.stringify([input.op, input.sourceAssetId, [...input.layerIds].sort(), input.seedLayerId ?? null, input.insertAssetId ?? null, round(input.start), round(input.end), input.fps, input.params]);
}

/** v1 limits the worker enforces (lib/ai/lanes/genesis/worker/compositor.py); quoted in the skill. */
export const GENESIS_LIMITS = { maxCameraShiftOfDiagonal: .004, maxNeverUncoveredOfFrame: .01, maxSeconds: 60 } as const;

/** Paid fallback for clean plates (removeObject, retimeLayer) when the free one cannot: a moving camera, or masked
 * pixels never uncovered. Bria Video Eraser, mask mode, on fal. Price checked November 2026. */
export const BRIA_ERASE_ENDPOINT = 'bria/bria_video_eraser/erase/mask', BRIA_USD_PER_SECOND = .14;
/** Bria accepts at most 5 s per call; longer ranges go in equal chunks of up to this length and are joined. */
export const BRIA_MAX_SECONDS_PER_CALL = 5;
/** SAM masks miss thin parts (tool handles): the erase mask is dilated by this many px at 1080p, scaled to the source. */
export const BRIA_MASK_DILATE_PX = 30;
/** Bria seconds each account may use per calendar month (UTC), by plan. Past it, the paid fallback refuses. */
export const BRIA_MONTHLY_SECONDS = { mcp: 60, pro: 120 } as const;
export const briaUsd = (seconds: number) => Math.round(seconds * BRIA_USD_PER_SECOND * 100) / 100;
