export const EDITOR_PLAN = {
  name: 'Revline Editor Pro',
  monthlyPrice: 39,
  currency: 'USD',
  trialDays: 3,
} as const;

export const ULTRA_PLAN = {
  name: 'Revline Ultra',
  monthlyPrice: 199,
  currency: 'USD',
} as const;

/** What Ultra adds on top of Pro, shown on the landing page and in the app. */
export const ULTRA_FEATURES = [
  'Frontier models',
  'MCP access for any AI agent',
  'Fast mode',
  'Pick the model for every edit',
  'Background removal and masking',
  '4K render',
  'Faster, parallel exports',
  '500 GB storage',
] as const;
