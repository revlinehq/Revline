import type { CleanupCut, CleanupOptions, SpeechWord } from './types';

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9']/g, '');
const FILLERS = new Set(['um', 'uh', 'erm', 'er', 'ah', 'hmm', 'mm', 'uhm']);

/** Restarts: when a phrase is started again shortly after, the earlier attempt is dropped and the
 * final take kept ("but this is not we- but this is not type- but this is not the type of views"). */
export function restartCuts(words: SpeechWord[], options: CleanupOptions): CleanupCut[] {
  const tokens = words.map(word => normalize(word.text));
  const cuts: CleanupCut[] = [];
  let consumedUntil = -1;
  for (let j = 1; j < tokens.length; j++) {
    if (!tokens[j] || FILLERS.has(tokens[j])) continue;
    // The earliest attempt within the window that the phrase at j repeats.
    let earliest = -1;
    for (let i = j - 1; i > consumedUntil && words[j].start - words[i].start <= options.restartWindow; i--) {
      if (tokens[i] !== tokens[j]) continue;
      let length = 0;
      while (j + length < tokens.length && i + length < j && tokens[i + length] === tokens[j + length]) length++;
      // A retake repeats most of what it abandons ("but this is not we- / but this is not the");
      // a new sentence reusing two words ("…instant gratification. So delayed gratification") does not.
      const attempt = j - i;
      if (attempt <= 12 && (length === attempt || (length >= 2 && length >= attempt / 2) || (length === 1 && attempt === 1))) earliest = i;
    }
    if (earliest < 0) continue;
    const removed = words.slice(earliest, j).map(word => word.text).join(' ');
    const span = words[j].start - words[earliest].start;
    cuts.push({ kind: 'restart', start: words[earliest].start, end: words[j].start, confidence: span < 3 ? .85 : .65, detail: removed });
    consumedUntil = j - 1;
  }
  return cuts;
}

/** Filler words a verbatim transcriber kept ("um", "uh") are cut with their own timestamps. */
export function fillerWordCuts(words: SpeechWord[]): CleanupCut[] {
  return words.filter(word => FILLERS.has(normalize(word.text))).map(word => ({ kind: 'filler' as const, start: word.start, end: word.end, confidence: .9, detail: `"${word.text}"` }));
}
