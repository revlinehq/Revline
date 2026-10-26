export const EDITOR_PLAN = {
  name: 'Revline Editor Pro',
  monthlyPrice: 39,
  currency: 'USD',
  trialDays: 3,
} as const;

/** Ultra is paused: Pro includes MCP. Its code and Stripe price stay for a later relaunch. */
export const ULTRA_OFFERED = false;

export const ULTRA_PLAN = {
  name: 'Revline Ultra',
  monthlyPrice: 199,
  currency: 'USD',
} as const;

/** What Ultra adds on top of Pro, shown on the landing page and in the app. */
export const ULTRA_FEATURES = [
  'Frontier models',
  'Fast mode',
  'Pick the model for every edit',
  '4K render',
  'Faster, parallel exports',
  '500 GB storage',
] as const;
