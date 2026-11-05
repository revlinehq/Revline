import type { rankHighlights, SemanticMoment } from './highlights';
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
type CandidateRange = Pick<ReturnType<typeof rankHighlights>[number], 'start' | 'end' | 'hook' | 'payoff' | 'qualified'>;

export function clipChoiceProblems(choice: ClipChoice, candidate: CandidateRange | undefined) {
  if (!candidate) return ['Unknown candidate ID. A found call replaces the candidate set; use IDs from the latest successful found result.'];
  const errors: string[] = [];
  if (!candidate.qualified) errors.push('This candidate did not pass the quality bar.');
  if (!choice.name.trim() || choice.name.length > 60) errors.push('Use a nonempty tab name of at most 60 characters.');
  if (![choice.start, choice.end].every(Number.isFinite)) return [...errors, 'Source start and end must be finite.'];
  const duration = choice.end - choice.start;
  if (duration < 15 || duration > 60) errors.push(`Duration ${duration.toFixed(3)}s must be between 15 and 60 seconds.`);
  if (choice.start > candidate.hook.start + .1) errors.push(`Start must be at or before ${candidate.hook.start + .1}s to retain the hook.`);
  if (choice.end < candidate.payoff.end - .03) errors.push(`End must be at or after ${candidate.payoff.end - .03}s to retain the payoff.`);
  if (Math.abs(choice.start - candidate.start) > 12) errors.push(`Start must be within 12s of the suggested ${candidate.start}s.`);
  if (Math.abs(choice.end - candidate.end) > 12) errors.push(`End must be within 12s of the suggested ${candidate.end}s.`);
  return errors;
}
