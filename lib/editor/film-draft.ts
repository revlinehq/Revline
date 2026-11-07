import { sectionCalls, skipText } from './approvals';
import { checkSceneCode } from './scene-compile';

/** One section() call of a film draft, in film seconds. */
export type DraftSection = { title: string; start: number; duration: number };

const timed = (code: string) => sectionCalls(code).flatMap(call => call.name !== undefined && call.start !== undefined && call.duration !== undefined ? [{ title: call.name, start: call.start, duration: call.duration, from: call.from, to: call.to }] : []);

/** The closers for every bracket still open at `to`, innermost first; undefined when the code there is not plain nesting. */
function openBrackets(code: string, to: number) {
  const stack: string[] = [];
  for (let at = 0; at < to; at++) {
    const skipped = skipText(code, at);
    if (skipped !== at) { if (skipped > to) return undefined; at = skipped - 1; continue; }
    const char = code[at];
    if (char === '(') stack.push(')');
    else if (char === '[') stack.push(']');
    else if (char === '{') stack.push('}');
    else if ((char === ')' || char === ']' || char === '}') && stack.pop() !== char) return undefined;
  }
  return stack.reverse();
}

/** Just past the call ending at `to`, including its semicolon. */
const afterCall = (code: string, to: number) => to + (/^[ \t]*;/.exec(code.slice(to))?.[0].length ?? 0);

/** The header of the first section() or shot() call after `from` that has not closed yet: the section being written. */
function writingAfter(code: string, from: number): DraftSection | undefined {
  // section(...) or shot(...): beat timing is already resolved to literals (lib/editor/beat-timing), which may keep a comment.
  const match = /(?<![\w$.])(?:section|shot)\s*\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:\/\*[^]*?\*\/\s*)?,/.exec(code.slice(from));
  return match && Number(match[4]) > 0 ? { title: match[2], start: Number(match[3]), duration: Number(match[4]) } : undefined;
}

/**
 * A film module still being streamed, closed after its last complete section() call: the shared code before it plus
 * every finished section, with the brackets still open there (the default export's body) closed. The cut is kept only
 * when it compiles; otherwise the caller keeps its last good cut.
 */
export function cutFilmDraft(code: string): { code?: string; sections: DraftSection[]; writing?: DraftSection } {
  const calls = timed(code), last = calls.at(-1);
  const sections = calls.map(({ title, start, duration }) => ({ title, start, duration }));
  const writing = writingAfter(code, last?.to ?? 0);
  if (!last) return { sections, writing };
  const end = afterCall(code, last.to), closers = openBrackets(code, end);
  if (!closers) return { sections, writing };
  const cut = `${code.slice(0, end)}\n${closers.join('\n')}\n`;
  try { checkSceneCode(cut); return { code: cut, sections, writing }; }
  catch { return { sections, writing }; }
}

/** A replacement snippet still being streamed, cut after its last complete section() call (for patchScene inserts). */
export function cutDraftSnippet(snippet: string): { text?: string; writing?: DraftSection } {
  const last = timed(snippet).at(-1);
  const writing = writingAfter(snippet, last?.to ?? 0);
  if (!last) return { writing };
  const end = afterCall(snippet, last.to);
  return openBrackets(snippet, end)?.length === 0 ? { text: snippet.slice(0, end), writing } : { writing };
}

/** Every section() call with literal timing in finished code. */
export const draftSections = (code: string): DraftSection[] => timed(code).map(({ title, start, duration }) => ({ title, start, duration }));
