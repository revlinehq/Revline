/** Genesis's own functions: one SAM 3.1 layer, reused by every layer function. MCP callers only. */
export const ownTools = ['segment', 'getLayer', 'layerEffect', 'textBehind'] as const;
// Supporting tools Genesis reuses instead of re-inventing: frame reads, point tracking, masks and looks.
export const tools = [
  ...ownTools,
  'readFrames',
  'inspectFrames',
  'trackPoints',
  'getTrack',
  'attachToTrack',
  'setMask',
  'setVisualEffects',
  'addTransition',
] as const;
