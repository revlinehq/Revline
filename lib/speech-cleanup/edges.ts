import { frameAt, timeAt, type Frames } from './frames';
import { levels } from './acoustic';
import type { SpeechWord } from './types';

/** Where each word's sound measurably begins and its decay ends, in source seconds.
 * A transcriber's times are close but can miss a soft onset or a trailing "s"; a join
 * snapped to these edges keeps the whole word and none of the room tone around it. */
export type WordEdge = { start: number; end: number };

const MAX_REACH = .3;

export function speechEdges(words: SpeechWord[], frames: Frames): WordEdge[] {
  const { silence } = levels(frames);
  const audible = (frame: number) => frame >= 0 && frame < frames.count && frames.db[frame] >= silence;
  return words.map((word, index) => {
    const previous = words[index - 1]?.end ?? 0, next = words[index + 1]?.start ?? Infinity;
    // Onset: back from inside the word while sound continues; a silent frame ends it, so a
    // breath separated by a moment of quiet stays outside the word.
    const floor = frameAt(Math.max(previous, word.start - MAX_REACH));
    // A transcriber may start a word just before its sound: find the sound first.
    let onset = frameAt(word.start);
    while (!audible(onset) && onset < frameAt(word.start + .15)) onset++;
    while (onset - 1 >= floor && audible(onset - 1)) onset--;
    // Decay: forward from the word's last stretch while it is still audible.
    const ceiling = frameAt(Math.min(next, word.end + MAX_REACH));
    let decay = frameAt(Math.max(word.start, word.end - .1));
    while (decay < ceiling && audible(decay)) decay++;
    const start = Math.max(0, timeAt(onset));
    return { start, end: Math.max(start + .01, timeAt(decay)) };
  });
}
