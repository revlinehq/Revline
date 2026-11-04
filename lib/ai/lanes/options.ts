// Small UI-only catalog; skill text and tool definitions stay on the server.
export type { LaneId } from './types';
export const LANE_OPTIONS = [
  { id: 'edit', label: 'Edit' },
  { id: 'motion', label: 'Motion' },
  { id: 'recreate', label: 'Recreate' },
  { id: 'explainer', label: 'Explainer' },
  { id: 'clip', label: 'Clip' },
  { id: 'reel', label: 'Reel' },
] as const;
