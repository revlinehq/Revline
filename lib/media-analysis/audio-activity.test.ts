import { expect, test } from 'vitest';
import { analyzeAudioActivity, refineAudioRangeEdges, refineTranscriptWithAudioActivity } from './audio-activity';
import { transcriptFromWords } from './transcript';
import { captionClipsFromTranscript } from '../editor/transcript-captions';

function frames(sections: { seconds: number; rms: number; peak?: number }[]) {
  const rmsDb: number[] = [], peakDb: number[] = [];
  for (const section of sections) for (let i = 0; i < Math.round(section.seconds * 100); i++) {
    rmsDb.push(section.rms); peakDb.push(section.peak ?? section.rms + 6);
  }
  return { rmsDb, peakDb };
}

test('refines the measured quiet tail while keeping the final word and provider timing intact', () => {
  const transcript = transcriptFromWords([{ text: 'you', start: .57, end: 1.19 }], 1.34);
  const activity = analyzeAudioActivity(frames([{ seconds: .75, rms: -22 }, { seconds: .59, rms: -65 }]), 1.34, transcript);
  expect(activity.reliable).toBe(true);
  expect(activity.quiet).toEqual([{ start: .75, end: 1.34 }]);
  expect(refineTranscriptWithAudioActivity(transcript, activity).words).toEqual([{ text: 'you', start: .57, end: .83 }]);
  expect(transcript.words[0].end).toBe(1.19);
});

test('preserves a low-energy consonant with peaks above the calibrated background', () => {
  const transcript = transcriptFromWords([{ text: 'yes', start: .2, end: 1.2 }], 1.4);
  const activity = analyzeAudioActivity(frames([{ seconds: .7, rms: -22 }, { seconds: .15, rms: -51, peak: -35 }, { seconds: .55, rms: -65 }]), 1.4, transcript);
  expect(activity.quiet[0].start).toBe(.85);
  expect(refineTranscriptWithAudioActivity(transcript, activity).words[0].end).toBe(.93);
});

test('calibrates to quiet speech instead of imposing a global silence cutoff', () => {
  const transcript = transcriptFromWords([{ text: 'soft', start: .1, end: 1.2 }], 1.5);
  const activity = analyzeAudioActivity(frames([{ seconds: .7, rms: -59 }, { seconds: .2, rms: -73, peak: -62 }, { seconds: .6, rms: -95 }]), 1.5, transcript);
  expect(activity.reliable).toBe(true);
  expect(activity.level.quietThresholdDb).toBeLessThan(-80);
  expect(activity.quiet[0].start).toBe(.9);
});

test('declines noisy/music-like levels and never invents speech for a silent word', () => {
  const noisy = transcriptFromWords([{ text: 'hello', start: .1, end: 1.2 }], 1.5);
  const music = analyzeAudioActivity(frames([{ seconds: .8, rms: -22 }, { seconds: .7, rms: -28 }]), 1.5, noisy);
  expect(music.reliable).toBe(false);
  expect(refineTranscriptWithAudioActivity(noisy, music)).toBe(noisy);
  const silent = transcriptFromWords([{ text: 'hallucination', start: .7, end: 1.2 }], 1.5);
  const activity = analyzeAudioActivity(frames([{ seconds: .5, rms: -22 }, { seconds: 1, rms: -65 }]), 1.5);
  expect(refineTranscriptWithAudioActivity(silent, activity)).toBe(silent);
  const allSilent = analyzeAudioActivity(frames([{ seconds: 1.5, rms: -120 }]), 1.5, noisy);
  expect(allSilent.reliable).toBe(false);
});

test('refuses short pauses, overlapping words, zero-duration words and insufficient voice evidence', () => {
  const short = transcriptFromWords([{ text: 'yes', start: .2, end: 1 }], 1.1);
  const brief = analyzeAudioActivity(frames([{ seconds: 1, rms: -22 }, { seconds: .1, rms: -65 }]), 1.1, short);
  expect(brief.quiet).toEqual([]);
  const activity = analyzeAudioActivity(frames([{ seconds: .75, rms: -22 }, { seconds: .75, rms: -65 }]), 1.5);
  for (const words of [
    [{ text: 'you', start: .57, end: 1.19 }, { text: 'too', start: .9, end: 1.3 }],
    [{ text: 'instant', start: .75, end: .75 }],
    [{ text: 'tiny', start: .73, end: 1.19 }],
  ]) {
    const transcript = transcriptFromWords(words, 1.5);
    expect(refineTranscriptWithAudioActivity(transcript, activity)).toBe(transcript);
  }
});

test('tightens only outer quiet edges and keeps the first raw word start for captions', () => {
  const transcript = transcriptFromWords([{ text: 'yes', start: .3, end: .9 }, { text: 'you', start: 1.5, end: 2.19 }], 2.34);
  const activity = analyzeAudioActivity(frames([{ seconds: .5, rms: -65 }, { seconds: .5, rms: -22 }, { seconds: .3, rms: -65 }, { seconds: .45, rms: -22 }, { seconds: .59, rms: -65 }]), 2.34, transcript);
  expect(refineAudioRangeEdges({ start: 0, end: 2.34 }, transcript, activity)).toEqual({ start: .3, end: 1.83 });
  expect(activity.quiet).toContainEqual({ start: 1, end: 1.3 });
  const internal = { start: .5, end: 1.7 };
  expect(refineAudioRangeEdges(internal, transcript, activity)).toBe(internal);
});

test('range and caption refinement agree when quiet contains instantaneous or out-of-range words', () => {
  const activity = analyzeAudioActivity(frames([{ seconds: .75, rms: -22 }, { seconds: 2.25, rms: -65 }]), 3);
  const range = { start: 0, end: 1.5 };
  for (const extra of [{ text: 'instant', start: 1, end: 1 }, { text: 'later', start: 2, end: 2.3 }]) {
    const transcript = transcriptFromWords([{ text: 'you', start: .57, end: 1.19 }, extra], 3);
    expect(refineAudioRangeEdges(range, transcript, activity)).toBe(range);
    const refined = refineTranscriptWithAudioActivity(transcript, activity);
    const captions = captionClipsFromTranscript({ id: 'source', kind: 'video', track: 1, sourceStart: 0, start: 0, duration: range.end }, refined, 30, () => 'caption');
    expect(captions.map(caption => caption.text).join(' ')).toContain('you');
  }
});

test('leading quiet does not skip an instantaneous first provider word', () => {
  const activity = analyzeAudioActivity(frames([{ seconds: .75, rms: -65 }, { seconds: .75, rms: -22 }]), 1.5);
  const transcript = transcriptFromWords([{ text: 'instant', start: .3, end: .3 }, { text: 'you', start: .7, end: 1.2 }], 1.5);
  const range = { start: 0, end: 1.5 };
  expect(refineAudioRangeEdges(range, transcript, activity)).toBe(range);
});
