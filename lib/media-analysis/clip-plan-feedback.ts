import { HIGHLIGHT_QUALITY_BAR, round as fmt, type rankHighlights, type SemanticMoment } from './highlights';
import type { TranscriptWord } from './transcript';

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function clipQuoteProblems(moment: SemanticMoment, words: TranscriptWord[]) {
  return (['hook', 'payoff'] as const).flatMap(field => {
    const line = moment[field];
    if (!line.text.trim()) return [];
    const measured = words.filter(word => word.start >= line.start - .2 && word.end <= line.end + .2);
    if (normalize(measured.map(word => word.text).join(' ')).includes(normalize(line.text))) return [];
    return [{ field, start: line.start, end: line.end, message: 'Quote does not match saved words in this source window.',
      words: measured.slice(0, 80), truncated: measured.length > 80 }];
  });
}

type ClipChoice = { candidateId: string; name: string; start: number; end: number };
type CandidateRange = Pick<ReturnType<typeof rankHighlights>[number], 'start' | 'end' | 'hook' | 'payoff' | 'qualified' | 'score'>;
/** What the accepted choice's existing tab keeps of the source (see retainedFootage). */
type TabFootage = { duration: number; epsilon: number; ranges: { start: number; end: number }[] };

/**
 * A choice without a built tab is a contiguous source range: 15-60 s, near the
 * suggested clean boundaries, keeping the hook and payoff. Once its tab exists,
 * the length rule measures what is on the timeline. A tab cut from several
 * source stretches is a montage: its accepted range is the retained span, and
 * the hook and payoff must sit inside retained footage, and only the start
 * keeps the 12 s nearness rule (the span's end is the last shot, not the
 * clean out point).
 */
export function clipChoiceProblems(choice: ClipChoice, candidate: CandidateRange | undefined, tab?: TabFootage) {
  if (!candidate) return ['Unknown candidate ID. A found call replaces the candidate set; use IDs from the latest successful found result.'];
  const errors: string[] = [];
  const footage = tab?.ranges.length ? tab : undefined;
  const montage = (footage?.ranges.length ?? 0) > 1;
  // A moment longer than 60 s fails the contiguous range rule but can still carry a montage.
  if (!candidate.qualified && !(montage && candidate.score >= HIGHLIGHT_QUALITY_BAR)) errors.push('This candidate did not pass the quality bar.');
  if (!choice.name.trim() || choice.name.length > 60) errors.push('Use a nonempty tab name of at most 60 characters.');
  if (![choice.start, choice.end].every(Number.isFinite)) return [...errors, 'Source start and end must be finite.'];
  const duration = footage ? footage.duration : choice.end - choice.start;
  if (duration < 15 || duration > 60) errors.push(`${footage ? 'Tab duration' : 'Duration'} ${duration.toFixed(3)}s must be between 15 and 60 seconds.`);
  if (footage) {
    const span = { start: footage.ranges[0].start, end: footage.ranges[footage.ranges.length - 1].end };
    if (Math.abs(choice.start - span.start) > footage.epsilon || Math.abs(choice.end - span.end) > footage.epsilon)
      errors.push(`Accept the tab's retained source span ${fmt(span.start)}-${fmt(span.end)}s as start/end.`);
  }
  if (montage) {
    const retains = (from: number, to: number) => footage!.ranges.some(r => r.start <= from + .1 && r.end >= to - .03);
    if (!retains(candidate.hook.start, candidate.hook.end)) errors.push(`Retained footage must contain the hook ${fmt(candidate.hook.start)}-${fmt(candidate.hook.end)}s.`);
    if (!retains(candidate.payoff.start, candidate.payoff.end)) errors.push(`Retained footage must contain the payoff ${fmt(candidate.payoff.start)}-${fmt(candidate.payoff.end)}s.`);
    if (Math.abs(choice.start - candidate.start) > 12) errors.push(`Start must be within 12s of the suggested ${candidate.start}s.`);
    return errors;
  }
  if (choice.start > candidate.hook.start + .1) errors.push(`Start must be at or before ${candidate.hook.start + .1}s to retain the hook.`);
  if (choice.end < candidate.payoff.end - .03) errors.push(`End must be at or after ${candidate.payoff.end - .03}s to retain the payoff.`);
  if (Math.abs(choice.start - candidate.start) > 12) errors.push(`Start must be within 12s of the suggested ${candidate.start}s.`);
  if (Math.abs(choice.end - candidate.end) > 12) errors.push(`End must be within 12s of the suggested ${candidate.end}s.`);
  return errors;
}
