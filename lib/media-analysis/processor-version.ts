/** The media-task contract this code implements. Workers send it when claiming
 * work, the edge controller reports it, and Convex returns it as the release
 * contract; tasks needing newer features set requiredProcessorVersion. */
// 36: persistent frame and analysis caching.
// 32: shared scene bundles. 33: keyframed reference crops. 34: uncapped scene media. 35: still-image reads/comparisons.
// 37: local runtime capabilities, resilient remote inputs and shared source reads.
// 38: cached Gemini highlight discovery and clip delivery checks.
// 39: full-resolution reference elements, calibrated opacity, shared joint timing/ease fitter.
// 40: integrated highlight/clip checks with the reference motion runtime.
// 41: lossless chunked transcript transport across worker and agent RPC boundaries.
// 42: keep tracked crop keyframes on the extracted review/render source clock.
// 43: explicit 1080p inspection must never be handled as a 720p preview.
// 44: decode bound scene video before the final Three VideoTexture draw.
// 45: independent-axis reference tracks and their saved geometry must bypass older workers/caches.
// 46: sparse capture windows retain video before an audio tail for final-frame holds.
export const MEDIA_PROCESSOR_VERSION = 46;
