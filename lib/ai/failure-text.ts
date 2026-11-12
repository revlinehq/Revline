import { runFailureOf } from './run-failure';

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
