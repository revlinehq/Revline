/** Genesis limits and prices in one place. The founder adjusts these, so each is a one-line change. */

/** Relight seconds each account may generate per calendar month (UTC), by plan. Past it, relight refuses. */
export const RELIGHT_MONTHLY_SECONDS = { mcp: 60, pro: 120 } as const;

/** Longest clip relight accepts, in seconds. Longer clips are refused with a trim/split hint. */
export const MAX_RELIGHT_SECONDS = 15;
/** Longest range one depth pass or depth effect covers, in seconds. */
export const MAX_DEPTH_SECONDS = 60;

/** fal.ai prices (checked November 2026). LightX bills per output second; Depth Anything Video per input second. */
export const RELIGHT_ENDPOINT = 'fal-ai/lightx/relight', RELIGHT_USD_PER_SECOND = .10;
/** LightX relights exactly the first 49 frames it receives and returns them at 10 fps: 4.9 billed seconds per call. */
export const LIGHTX_FRAMES = 49, LIGHTX_OUTPUT_FPS = 10;
export const DEPTH_ENDPOINT = 'fal-ai/depth-anything-video', DEPTH_USD_PER_SECOND = .04;
/** VDA-Small is Apache-2.0. Base and Large are CC-BY-NC (non-commercial), so Genesis never uses them. */
export const DEPTH_MODEL = 'VDA-Small';

/** Relit and depth-effect videos are delivered at this short side (1080p). */
export const OUTPUT_SHORT_SIDE = 1080;

/** LightX mode for explicit sun angles: `hdr` (an environment image rendered from the sun) or `ic` (nearest side plus angle words). */
export const EXPLICIT_LIGHT_MODE: 'hdr' | 'ic' = 'hdr';
