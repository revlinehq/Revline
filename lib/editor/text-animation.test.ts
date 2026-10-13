import { expect, test } from 'vitest';
import { generateComposition } from './composition';
import { motionPreset } from './clip-effects';
import { textAnimationSteps, serializeTextAnimation } from './text-animation';
import { EMPTY_TIMELINE, type Clip } from './types';

test('export includes the same text motion program used by live edits', () => {
  const caption: Clip = { id: 'words', kind: 'caption', text: 'Hello', start: 3, duration: 2, sourceStart: 0 };
  const clip = { ...caption, ...motionPreset(caption, 'pop') };
  const html = generateComposition({ ...EMPTY_TIMELINE, clips: [clip] }, []);
  const steps = textAnimationSteps(clip, 0, 1080, 1920);
  expect(steps.length).toBeGreaterThan(1);
  for (const step of steps) expect(html).toContain(serializeTextAnimation(step, 'textTimeline'));
  expect(steps.find(step => step.method === 'fromTo')?.at).toBe(3);
  expect(html).toContain("window.__revlineTextTimelines['clip-0']=textTimeline");
});

test('legacy rise uses canvas resolution and fades at the exact clip end', () => {
  const clip: Clip = { id: 'text', kind: 'graphic', start: 2, duration: .6, sourceStart: 0, animation: 'rise' };
  const steps = textAnimationSteps(clip, 4, 720, 1280, 720);
  expect(steps[0].from?.y).toBeCloseTo(32 * 720 / 1080);
  expect(steps[0].at).toBe(2);
  expect(steps[1].at + Number(steps[1].vars.duration)).toBeCloseTo(2.6);
  expect(textAnimationSteps({ ...clip, animation: 'none' }, 4, 720, 1280)).toEqual([]);
});
