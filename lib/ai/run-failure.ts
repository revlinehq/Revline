import { ConvexError, v } from 'convex/values';

/** What kind of failure a step of an assistant run met. The run, its retry rules and the chat decide on this code,
 * never on the sentence beside it, so rewording a message cannot change what a run does.
 * - conflict: the timeline moved underneath the run (the user's editor, a finished job). Re-read and try again.
 * - locked: the run no longer holds the project (stopped, replaced, or another edit owns it). Nothing more can run.
 * - refused: a rule, a check, the model's safety rules or this deployment's configuration refused the step (approved
 *   work, a lane's tools, a missing API key). Asking again the same way gets the same answer.
 * - limit: a plan, credit, rate, token, step or output limit was reached.
 * - unavailable: a service, a model or a step did not answer, timed out or did not complete for now. Trying again may work.
 * - invalid: the step's input could not be used (a timeline that does not validate, a clip that does not exist).
 * - internal: Revline's own fault, or a failure nobody classified. */
export const RUN_FAILURE_CODES = ['conflict', 'locked', 'refused', 'limit', 'unavailable', 'invalid', 'internal'] as const;
export type RunFailureCode = typeof RUN_FAILURE_CODES[number];
export type RunFailure = { code: RunFailureCode; message: string };
/** A stored code, beside the stored sentence. */
export const runFailureCodeValidator = v.union(...RUN_FAILURE_CODES.map(code => v.literal(code)));

/** Billing's own codes (convex/lib/plan_limits.ts): their dialog reads them as they are, and a run reads them as limits. */
const PLAN_LIMIT_CODES = ['usage_limit', 'storage_full'] as const;

const isRunFailureCode = (value: unknown): value is RunFailureCode => typeof value === 'string' && (RUN_FAILURE_CODES as readonly string[]).includes(value);
const runCode = (value: unknown): RunFailureCode | undefined => isRunFailureCode(value) ? value : (PLAN_LIMIT_CODES as readonly unknown[]).includes(value) ? 'limit' : undefined;

/** The error a run-path function throws: `ConvexError({ code, message })`. Its data crosses runMutation and the agent
 * runner's bridge intact, and its text (`{"code":…,"message":…}`) keeps the code in stored tool errors. */
export function runFailure(code: RunFailureCode, message: string) {
  return new ConvexError<RunFailure>({ code, message });
}

/** An Error class raised inside the turn itself (not by a Convex function) names its code here. */
export type CodedError = Error & { readonly failureCode: RunFailureCode };

function fromRecord(value: unknown): RunFailure | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { code, message, errorCode, error } = value as Record<string, unknown>;
  // A ConvexError's data, a tool-write envelope, a stored failure: { code, message }.
  const named = runCode(code);
  if (named && typeof message === 'string') return { code: named, message };
  // A tool's failed result: { success: false, error, errorCode }.
  const reported = runCode(errorCode);
  if (reported) return { code: reported, message: typeof error === 'string' ? error : typeof message === 'string' ? message : '' };
  return undefined;
}

/** The JSON object in `text` that carries a code, parsed; transport prefixes and stack frames around it are ignored.
 * Only spans that open just before a `"code"` key are tried, against the few closing braces after it. */
function fromText(text: string): RunFailure | undefined {
  for (let key = text.indexOf('"code"'), keys = 0; key >= 0 && keys < 3; key = text.indexOf('"code"', key + 1), keys++) {
    const start = text.lastIndexOf('{', key);
    if (start < 0) continue;
    for (let end = text.indexOf('}', key), ends = 0; end >= 0 && ends < 4; end = text.indexOf('}', end + 1), ends++) {
      try { const found = fromRecord(JSON.parse(text.slice(start, end + 1))); if (found) return found; } catch { /* not this span */ }
    }
  }
  return undefined;
}

/** The code and sentence a failure carries, from wherever it is read: a thrown ConvexError (its data), an Error class
 * with `failureCode`, a tool's failed result (`errorCode`), or stored text that still holds the JSON. Undefined for a
 * failure raised without a code (an older stored turn, an SDK or network error): callers read its text the old way. */
export function runFailureOf(value: unknown): RunFailure | undefined {
  if (value && typeof value === 'object') {
    const declared = (value as { failureCode?: unknown }).failureCode;
    if (isRunFailureCode(declared)) return { code: declared, message: value instanceof Error ? value.message : String((value as { message?: unknown }).message ?? '') };
    const data = (value as { data?: unknown }).data;
    const coded = fromRecord(data) ?? (typeof data === 'string' ? fromText(data) : undefined) ?? fromRecord(value);
    if (coded) return coded;
  }
  const text = typeof value === 'string' ? value : value instanceof Error ? value.message : '';
  return text ? fromText(text.slice(0, 8_000)) : undefined;
}

/** Shared timeline validation also serves the user's editor, whose save queue reads its refusals as plain sentences.
 * A run-path function that calls it gives what it refuses the run's code. */
export async function codedAs<T>(code: RunFailureCode, work: () => Promise<T> | T): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ConvexError && typeof error.data === 'string') throw runFailure(code, error.data);
    throw error;
  }
}
