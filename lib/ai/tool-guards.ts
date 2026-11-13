/** A tool refusal that only asks the agent to take another step first (start a task, plan the effect, build the tabs).
 * It is still an error to the agent, so its retry accounting and completion repair keep working, but it is the agent's
 * own order of work, not something the user asked for going wrong: the chat leaves it out of the run's steps. */
const STEP_ORDER_TAG = 'Do this first: ';

export function stepOrderGuard(message: string) {
  return new Error(`${STEP_ORDER_TAG}${message}`);
}

// Runs saved before the editing tools re-read the timeline themselves refused every edit with this sentence.
const LEGACY_INSPECT_GUARD = 'Inspect the current timeline before continuing the saved edit';

/** Whether a stored tool error is a step-order guard. The guard opens the message, possibly behind a transport
 * prefix ("Error: …", "Tool x failed: …"); an error that only quotes one inside a longer failure is a real failure. */
const GUARD_OPENINGS = ['Do this first:', LEGACY_INSPECT_GUARD];
export function isStepOrderGuard(text: string | undefined) {
  if (!text) return false;
  const message = text.trim(), prefix = /^[^:\n]{1,60}:\s*/.exec(message)?.[0].length ?? 0;
  return GUARD_OPENINGS.some(opening => message.startsWith(opening) || message.startsWith(opening, prefix));
}
