import { runFailureOf, type RunFailure, type RunFailureCode } from './run-failure';

/** A failure as stored or thrown, reduced to the sentence a person wrote: Convex's transport wrapping ("[CONVEX
 * M(...)]", "Uncaught ConvexError:", request ids, "at handler (file:line)") and a tool write's JSON envelope are
 * removed. Empty when nothing readable is left. The raw text stays where it was recorded; this is only for reading. */
export function plainFailureText(value: unknown): string {
  let text = typeof value === 'string' ? value : value instanceof Error ? value.message : value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string' ? String((value as { message: string }).message) : '';
  for (let pass = 0; pass < 3; pass++) {
    // A coded failure ({"code":"conflict","message":"..."}, a tool-write envelope with its code): the message is the reason.
    const coded = runFailureOf(text);
    if (coded?.message) text = coded.message;
    // {"kind":"tool-write-failed","message":"..."}, stored before codes: the message is the reason.
    const envelope = /\{"kind":"tool-write-failed","message":("(?:[^"\\]|\\.)*")\}/.exec(text);
    if (envelope) { try { text = JSON.parse(envelope[1]) as string; } catch { /* keep the text as it is */ } }
    const cleaned = text
      .replace(/\[CONVEX [^\]]*\]/g, ' ').replace(/\[Request ID: [^\]]*\]/g, ' ')
      .replace(/\b(?:Server Error|Called by client)\b:?/g, ' ')
      .replace(/\bUncaught (?:\w*Error): /g, ' ').replace(/^\s*(?:\w*Error:\s*)+/, '')
      .replace(/\s+at \S+ \([^)]*:\d+:\d+\)[\s\S]*$/, '').replace(/\s+at (?:async )?\S+\.[cm]?[jt]sx?:\d+:\d+[\s\S]*$/, '')
      .replace(/\s+/g, ' ').trim();
    if (cleaned === text) break;
    text = cleaned;
  }
  return text;
}

/** A short code for a failure nobody has put into words yet. It is derived from the stored text alone, so the
 * same code can be recomputed from the turn's record or the logs to find what it stands for. */
export function failureReference(raw: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index++) { hash ^= raw.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-6);
}

/** The reason an application check refused something, as its author wrote it: a ConvexError's own text
 * (`data`, or `data.message`). Empty for any other error, so callers can tell a refusal from a crash. */
export function refusalReason(error: unknown): string {
  const data = error && typeof error === 'object' && 'data' in error ? (error as { data?: unknown }).data : undefined;
  const text = typeof data === 'string' ? data : data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string' ? (data as { message: string }).message : '';
  return text.trim().slice(0, 1000);
}

/** Failures stored before codes: older turns and tool results, a runner or backend one release behind, and errors that
 * never pass a coded path (the AI SDK's own, the network's). `keep`: the sentence is written for the user; `say`: what
 * the chat said for it before codes; neither: it is a diagnostic and the chat words the code itself. The sentence rules exist for one release: once no stored
 * turn or deployed runner predates codes, delete them; the SDK and network rules stay. */
const LEGACY_FAILURES: readonly { pattern: RegExp; code: RunFailureCode; keep: boolean; say?: string }[] = [
  { pattern: /\bTimelineGestureRejection:\s*Overlaps a clip\b/i, code: 'invalid', keep: false, say: 'These clips would overlap. This edit was not saved; previously saved edits remain.' },
  { pattern: /timeline changed elsewhere|timeline changed while|revision conflict/i, code: 'conflict', keep: true },
  { pattern: /AI run is no longer active|editing attempt has been replaced/i, code: 'locked', keep: true },
  { pattern: /\bAI_NoSuchToolError\b|unavailable tool|is not available in this step/i, code: 'refused', keep: false, say: 'The assistant reached for a tool that is not available for this kind of edit, so that step did nothing. Send the request again, or say it another way.' },
  { pattern: /\bAI_(?:InvalidToolInput|TypeValidation|InvalidArgument|JSONParse|ToolCallRepair)Error\b|Type validation failed|Invalid input for tool/i, code: 'invalid', keep: false },
  { pattern: /\bAI_(?:APICall|Retry|NoOutputGenerated|NoContentGenerated|EmptyResponseBody|LoadAPIKey)Error\b|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i, code: 'unavailable', keep: false },
  { pattern: /composition review is not configured/i, code: 'unavailable', keep: true },
  { pattern: /credits.*exhausted|billing|token budget|used (?:this period’s|today’s) AI usage/i, code: 'limit', keep: true },
  { pattern: /authentication failed|cannot access the selected model|requires \w*API_KEY|^(?:Revline editing supports GPT-)/i, code: 'refused', keep: true },
  { pattern: /Source trim|Clip timing|Clip media/, code: 'invalid', keep: true },
  { pattern: /replacement was not saved|requested changes were not saved|Inspect the current timeline/, code: 'refused', keep: true },
];

/** The code and sentence of a failure stored as text before codes, or undefined when nothing here recognizes it. */
export function legacyRunFailure(value: unknown): RunFailure | undefined {
  const raw = typeof value === 'string' ? value : value instanceof Error ? `${value.name}: ${value.message}` : '';
  const rule = raw ? LEGACY_FAILURES.find(item => item.pattern.test(raw)) : undefined;
  return rule && { code: rule.code, message: rule.say ?? (rule.keep ? plainFailureText(raw) : '') };
}

/** What kind of failure this is and what it says: its code where it carries one (lib/ai/run-failure), otherwise what
 * its stored text shows. Undefined when neither says. */
export function describeRunFailure(value: unknown): RunFailure | undefined {
  return runFailureOf(value) ?? legacyRunFailure(value);
}
