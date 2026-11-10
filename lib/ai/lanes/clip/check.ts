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
/** A clip task whose cuts were given as source ranges: the request did not ask Revline to choose the moments
 * (findMoments, set by lanes.begin from the request) and the task never started a clipping run with findHighlights.
 * Task rows from before findMoments existed keep the plan and analysis requirement. */
export const cutsGiven = (task: { lane: string; findMoments?: boolean }, clipRunStarted: boolean) =>
  task.lane === 'clip' && task.findMoments === false && !clipRunStarted;
export function check(_context: LaneCheckContext): string[] {
  return [
    'Read persisted clipping.completionState using the stable taskId; do not accept caller-provided counts.',
  ];
}
