export function isUsageCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function usageCountOrNull(value: unknown): number | null {
  return isUsageCount(value) ? value : null;
}
