/** Clip-local luminous outlines. All controls are normalized; color is sRGB. */
export type NeonEdges = {
  enabled: boolean;
  amount: number;
  color: string;
  detail: number;
  threshold: number;
  glow: number;
};

export const DEFAULT_NEON_EDGES: Readonly<NeonEdges> = Object.freeze({
  enabled: false, amount: .9, color: '#36f9f2', detail: .65, threshold: .15, glow: .65,
});
export const NEON_EDGE_LIMITS = { amount: [0, 1], detail: [0, 1], threshold: [0, 1], glow: [0, 1] } as const;

export function validateNeonEdges(settings: NeonEdges) {
  if (!settings || typeof settings !== 'object' || typeof settings.enabled !== 'boolean') throw new Error('Invalid neonEdges settings.');
  if (Object.keys(settings).some(key => !['enabled', 'color', ...Object.keys(NEON_EDGE_LIMITS)].includes(key))) throw new Error('Unknown neonEdges control.');
  if (typeof settings.color !== 'string' || !/^#[\da-f]{6}$/i.test(settings.color)) throw new Error('neonEdges.color must be a six-digit hex color.');
  for (const [key, [min, max]] of Object.entries(NEON_EDGE_LIMITS)) {
    const value = settings[key as keyof typeof NEON_EDGE_LIMITS];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`neonEdges.${key} must be between ${min} and ${max}.`);
  }
}
