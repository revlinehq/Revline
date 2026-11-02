/** The media-task contract this code implements. Workers send it when claiming
 * work, the edge controller reports it, and Convex returns it as the release
 * contract; tasks needing newer features set requiredProcessorVersion. */
// 32: shared scene import/bundle registry. 33: keyframed reference crops.
export const MEDIA_PROCESSOR_VERSION = 33;
