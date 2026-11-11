import { plainFailureText } from '../../lib/ai/failure-text';

/** Cleanup and bookkeeping that follows finished work: releasing a request, recording evidence, filing an incident.
 * A failure here is logged and never thrown, so it cannot turn a step that succeeded into one that failed or hide
 * the error the step was already reporting. Never wrap the work itself in this. */
export async function safely<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
  try { return await work(); }
  catch (error) {
    console.warn(`[cleanup-failed] ${JSON.stringify({ label, error: (plainFailureText(error) || String(error)).slice(0, 300) })}`);
    return undefined;
  }
}
