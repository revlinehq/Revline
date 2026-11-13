/** Plan limits the server reports in a ConvexError's data (convex/lib/plan_limits.ts). */
export type PlanLimit = { code: 'storage_full' | 'usage_limit'; message: string; tier?: string; resetsAt?: number; trial?: boolean };
const EVENT = 'revline:plan-limit';

/** The plan limit an error carries, if it is one. */
export function planLimitOf(error: unknown): PlanLimit | null {
  const data = error && typeof error === 'object' && 'data' in error ? (error as { data: unknown }).data : null;
  if (!data || typeof data !== 'object') return null;
  const { code, message } = data as Record<string, unknown>;
  return (code === 'storage_full' || code === 'usage_limit') && typeof message === 'string' ? data as PlanLimit : null;
}
/** Tells the open page's PlanLimitDialog that an action hit a plan limit, so it can offer the upgrade. */
export function notifyPlanLimit(error: unknown) {
  const limit = planLimitOf(error);
  if (limit && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<PlanLimit>(EVENT, { detail: limit }));
}
export function onPlanLimit(listener: (limit: PlanLimit) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<PlanLimit>).detail);
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
