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
      // a sentence reusing words ("low effort content attracts low effort viewers") does not.
      const attempt = j - i;
      if (attempt <= 12 && (length === attempt || (length >= 2 && length >= attempt * .75) || (length === 1 && attempt === 1))) earliest = i;
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

type Phrase = { from: number; to: number; tokens: string[]; abandoned: boolean };

/** Sentences (or pause-separated phrases) with their spoken tokens, fillers excluded. */
function phrases(words: SpeechWord[]): Phrase[] {
  const out: Phrase[] = [];
  let from = 0;
  for (let index = 0; index < words.length; index++) {
    const text = words[index].text.trim(), next = words[index + 1];
    const ends = /[.!?…]$/.test(text) || /[-–]$/.test(text) || !next || next.start - words[index].end > .45;
    if (!ends) continue;
    const tokens = words.slice(from, index + 1).map(word => normalize(word.text)).filter(token => token && !FILLERS.has(token));
    out.push({ from, to: index, tokens, abandoned: /(\.\.\.|…|[-–])$/.test(text) });
    from = index + 1;
  }
  return out;
}

/** Longest common subsequence length of two token lists. */
function common(a: string[], b: string[]) {
  let previous = new Array(b.length + 1).fill(0);
  for (const token of a) {
    const row = [0];
    for (let j = 0; j < b.length; j++) row.push(token === b[j] ? previous[j] + 1 : Math.max(previous[j + 1], row[j]));
    previous = row;
  }
  return previous[b.length];
}

/** Retakes across sentences: a speaker re-records a line, often reworded and well apart. An earlier
 * sentence mostly repeated by a later one is an earlier take; a sentence cut off ("...") that another
 * nearby sentence covers is abandoned. The last full take is kept. Each cut runs to the next spoken
 * phrase, so no dead air is left where the take was. */
export function retakeCuts(words: SpeechWord[], options: CleanupOptions): CleanupCut[] {
  const list = phrases(words), cuts: CleanupCut[] = [];
  list.forEach((phrase, index) => {
    if (phrase.tokens.length < 2) return;
    const start = words[phrase.from].start, end = words[phrase.to].end;
    let covered = false;
    for (let other = index + 1; other < list.length && words[list[other].from].start - end <= options.retakeWindow; other++) {
      const later = list[other];
      // A retake split by a pause still counts, so a shorter later phrase may take the one after it.
      const candidates = later.tokens.length < phrase.tokens.length && list[other + 1] ? [later.tokens, [...later.tokens, ...list[other + 1].tokens]] : [later.tokens];
      for (const tokens of candidates) {
        const shared = common(phrase.tokens, tokens);
        // Similar length and wording: the same line again, not two sentences sharing a few words.
        if (phrase.tokens.length >= 3 && shared >= 3 && shared >= Math.max(phrase.tokens.length, tokens.length) * .6) covered = true;
        // A false start that the later phrase begins with again ("In a short time, / in a short time, you're getting").
        let prefix = 0; while (prefix < phrase.tokens.length && phrase.tokens[prefix] === tokens[prefix]) prefix++;
        if (prefix >= 2 && prefix >= phrase.tokens.length * .8 && tokens.length > phrase.tokens.length) covered = true;
        // A cut-off attempt only needs to be continued by the later one.
        if (phrase.abandoned && shared >= Math.max(2, phrase.tokens.length * .6)) covered = true;
      }
      if (covered) break;
    }
    if (!covered) return;
    const next = list[index + 1];
    cuts.push({ kind: 'restart', start, end: next ? words[next.from].start : words[phrase.to].end, confidence: phrase.abandoned ? .85 : .75, detail: words.slice(phrase.from, phrase.to + 1).map(word => word.text).join(' ') });
  });
  return cuts;
}
