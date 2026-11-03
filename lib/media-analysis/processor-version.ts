/** The media-task contract this code implements. Workers send it when claiming
 * work, the edge controller reports it, and Convex returns it as the release
 * contract; tasks needing newer features set requiredProcessorVersion. */
// 36: persistent frame and analysis caching.
// 32: shared scene bundles. 33: keyframed reference crops. 34: uncapped scene media. 35: still-image reads/comparisons.
// 37: local runtime capabilities, resilient remote inputs and shared source reads.
export const MEDIA_PROCESSOR_VERSION = 38;

// 38: cached Gemini highlight discovery and clip delivery checks (36/37 reserved by frame-cache/worker fixes).
