import type { LaneCheckContext } from '../types';
export type ClippingCompletion = {
  required: boolean;
  passed: boolean;
  errors: string[];
  finalMessage?: string;
};
// The find-highlights branch owns the candidate ledger and worker-issued tab receipts.
export async function checkCompletion(
  read: () => Promise<ClippingCompletion>,
): Promise<string[]> {
  try {
    const state = await read();
    if (state.required && state.passed) return [];
    return state.errors?.length
      ? state.errors
      : [
          'No accepted highlight delivery was certified. A /clip task requires a clips manifest; candidates-only inspection cannot finish it.',
        ];
  } catch {
    return [
      'Clip completion integration pending: clipping.completionState from find-highlights is not deployed.',
    ];
  }
}
export function check(_context: LaneCheckContext): string[] {
  return [
    'Read persisted clipping.completionState using the stable taskId; do not accept caller-provided counts.',
  ];
}
