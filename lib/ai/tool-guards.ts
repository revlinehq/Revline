/** A tool refusal that only asks the agent to take another step first (start a task, plan the effect, build the tabs).
 * It is still an error to the agent, so its retry accounting and completion repair keep working, but it is the agent's
 * own order of work, not something the user asked for going wrong: the chat leaves it out of the run's steps. */
const STEP_ORDER_TAG = 'Do this first: ';

export function stepOrderGuard(message: string) {
  return new Error(`${STEP_ORDER_TAG}${message}`);
}

// Runs saved before the editing tools re-read the timeline themselves refused every edit with this sentence.
const LEGACY_INSPECT_GUARD = 'Inspect the current timeline before continuing the saved edit';

/** Whether a stored tool error is a step-order guard; the tag may sit behind a transport prefix. */
export function isStepOrderGuard(text: string | undefined) {
  return !!text && (text.includes(STEP_ORDER_TAG) || text.includes(LEGACY_INSPECT_GUARD));
}
