/** Hints for takes a speaker said again in other words: a sentence mostly re-said by a later one, a sentence restarted
 * midway, the same numbers and names said twice. They sit next to the cut's prose; the model's reading decides. */

type Word = { text: string };
type Token = { value: string; word: number };
export type RetakeHint = {
  /** Index of the sentence holding the earlier copy. */
  sentence: number;
  /** Word indices (into that sentence's words) of the earlier copy, from..to inclusive. */
  from: number;
  to: number;
  /** The sentence that says it again (the same one for a restart inside a sentence). */
  again: number;
  kind: 'reworded' | 'restart';
};

const CONTRACTIONS: Record<string, string[]> = { "won't": ['will', 'not'], "can't": ['can', 'not'], "cannot": ['can', 'not'], "ain't": ['is', 'not'], "let's": ['let', 'us'] };
const SUFFIXES: [RegExp, string[]][] = [[/n't$/, ['not']], [/'re$/, ['are']], [/'ll$/, ['will']], [/'ve$/, ['have']], [/'m$/, ['am']], [/'d$/, ['would']], [/'s$/, ['is']]];
const FILLERS = new Set(['um', 'uh', 'erm', 'er', 'ah', 'hmm', 'mm', 'uhm']);
const STOP = new Set(['i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'a', 'an', 'the', 'and', 'or', 'but', 'so', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'not', 'just', 'like', 'there', 'here', 'what', 'which', 'who', 'how', 'why', 'when', 'then', 'than', 'also', 'very', 'really', 'actually', 'literally', 'basically', 'okay', 'ok', 'yeah', 'well', 'now', 'right', 'get', 'go', 'going', 'all', 'more', 'some', 'any', 'only', 'even', 'every', 'one']);

/** Plain words a listener hears: lower case, contractions spelled out, numbers without "$" or commas, a plural's "s" off. */
export function spokenTokens(words: Word[]): Token[] {
  const out: Token[] = [];
  words.forEach((word, index) => {
    const raw = word.text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
    if (!raw || FILLERS.has(raw)) return;
    let parts = CONTRACTIONS[raw];
    if (!parts) {
      const suffix = SUFFIXES.find(([pattern]) => pattern.test(raw));
      parts = suffix ? [raw.replace(suffix[0], '') || raw, ...suffix[1]] : [raw];
      // "don't" → "do not", "isn't" → "is not"; "that's" → "that is".
    }
    for (const part of parts) {
      const value = part.length > 3 && /s$/.test(part) && !/(ss|us|is)$/.test(part) && !STOP.has(part) ? part.slice(0, -1) : part;
      out.push({ value, word: index });
    }
  });
  return out;
}

/** Numbers and names: what makes a claim the same claim when the wording changes. */
function facts(words: Word[]) {
  const found = new Set<string>();
  words.forEach((word, index) => {
    const text = word.text.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9%]+$/g, '');
    if (/\d/.test(text)) found.add(text.replace(/[^0-9.]/g, '').replace(/\.0+$/, ''));
    else if (index > 0 && /^[A-Z][a-z]/.test(text) && text !== 'I') found.add(text.toLowerCase());
  });
  return found;
}

/** Longest common subsequence length of two value lists. */
function common(a: string[], b: string[]) {
  let previous = new Array(b.length + 1).fill(0);
  for (const item of a) {
    const row = [0];
    for (let j = 0; j < b.length; j++) row.push(item === b[j] ? previous[j] + 1 : Math.max(previous[j + 1], row[j]));
    previous = row;
  }
  return previous[b.length];
}

/** Sentences of one speaker in timeline order, each with its start and end second. */
export function retakeHints(sentences: { words: Word[]; start: number; end: number }[], options: { window?: number; ahead?: number } = {}): RetakeHint[] {
  const window = options.window ?? 45, ahead = options.ahead ?? 6, hints: RetakeHint[] = [];
  const tokens = sentences.map(sentence => spokenTokens(sentence.words)), values = tokens.map(list => list.map(token => token.value));
  const known = sentences.map(sentence => facts(sentence.words));
  sentences.forEach((sentence, index) => {
    // A restart inside the sentence: three or more words said, then said again a few words later ("and see that Call of
    // Duty is going to pay you and see that Call of Duty campaign will pay you").
    const list = tokens[index];
    restart: for (let i = 0; i < list.length; i++) for (let j = i + 3; j < list.length && j - i <= 14; j++) {
      let length = 0;
      while (j + length < list.length && i + length < j && list[i + length].value === list[j + length].value) length++;
      const content = list.slice(i, i + length).filter(token => !STOP.has(token.value)).length;
      if (length >= 3 && content >= 2 || length >= 5) {
        hints.push({ sentence: index, from: list[i].word, to: list[j].word - 1, again: index, kind: 'restart' });
        break restart;
      }
    }
    // A sentence a later one says again, reworded: most of its words come back in order, or its numbers and names do.
    const earlier = values[index];
    if (earlier.length < 3 || !sentence.words.length) return;
    for (let other = index + 1; other < sentences.length && other - index <= ahead && sentences[other].start - sentence.end <= window; other++) {
      // A retake split by a full stop still counts: a shorter later sentence may take the one after it.
      const later = values[other].length < earlier.length && values[other + 1] ? [...values[other], ...values[other + 1]] : values[other];
      const shared = common(earlier, later), ratio = shared / earlier.length;
      const content = new Set(earlier.filter(value => !STOP.has(value) && later.includes(value))).size;
      const sameFacts = [...known[index]].filter(fact => known[other].has(fact) || known[other + 1]?.has(fact)).length;
      if (shared >= 3 && content >= 2 && (ratio >= .6 || sameFacts >= 2 && ratio >= .4)) {
        // Name the sentence that says it again: of a pair, the one sharing more of it.
        const again = later !== values[other] && common(earlier, values[other + 1]) > common(earlier, values[other]) ? other + 1 : other;
        hints.push({ sentence: index, from: 0, to: sentence.words.length - 1, again, kind: 'reworded' });
        return;
      }
    }
  });
  return hints;
}
