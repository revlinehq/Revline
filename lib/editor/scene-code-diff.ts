import { createTwoFilesPatch } from 'diff';

/** A bounded page of a unified diff. Character offsets also handle modules written on one long line. */
export function sceneCodeDiff(before: string, after: string, fromRevision: number, toRevision: number, options: { offset?: number; limit?: number; context?: number }) {
  const patch = createTwoFilesPatch(`revision-${fromRevision}`, `revision-${toRevision}`, before, after, undefined, undefined, { context: options.context ?? 3, timeout: 1000, maxEditLength: 2000 });
  if (patch === undefined) throw new Error('This diff exceeded its work limit. Compare closer revisions.');
  const offset = options.offset ?? 0, limit = options.limit ?? 200;
  let end = Math.min(offset, patch.length);
  for (let count = 0; count < limit && end < patch.length; count++) {
    const newline = patch.indexOf('\n', end);
    end = Math.min(newline < 0 ? patch.length : newline + 1, offset + 30_000);
    if (end - offset === 30_000) break;
  }
  return { changed: before !== after, fromRevision, toRevision, format: 'unified', totalCharacters: patch.length, offset, diff: patch.slice(offset, end), ...(end < patch.length ? { nextOffset: end } : {}),
    note: 'Hunk headers give old and new 1-based line ranges. Minus lines were removed, plus lines were added. Continue with offset = nextOffset (a character offset) when present; keep the same revisions and context. A page is capped at 30,000 characters and can split a long line; concatenate pages without adding separators.' };
}
