import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { TextAnimationPreview } from './text-animation-preview';
import type { Clip } from '@/lib/editor/types';

test('a split text clip previews its selected entrance from the card clock', () => {
  const clip: Clip = { id: 'split-text', kind: 'graphic', start: 12, duration: 2, sourceStart: 0, text: 'Keep these words', fontFamily: 'inter', textTemplate: { preset: 'word-reveal', duration: 20, offset: 8 } };
  const html = renderToStaticMarkup(<TextAnimationPreview preset="word-reveal" frame={3} clip={clip}/>);
  expect(html).toContain('data-remotion-text="word-reveal" data-frame="3"');
  expect(html.match(/font-family:Revline Text inter/g)).toHaveLength(2);
  expect(clip.textTemplate).toEqual({ preset: 'word-reveal', duration: 20, offset: 8 });
});

test('a long speech-timed caption gets a standalone card preview without invalid timings', () => {
  const clip: Clip = { id: 'speech', kind: 'caption', start: 4, duration: 8, sourceStart: 0, text: 'Two words', textTemplate: { preset: 'karaoke', duration: 8, offset: 2, wordTimings: [{ start: 4, end: 5 }, { start: 6, end: 7 }] } };
  const html = renderToStaticMarkup(<TextAnimationPreview preset="karaoke" frame={3} clip={clip}/>);
  expect(html).toContain('data-remotion-text="karaoke" data-frame="3"');
  expect(clip.textTemplate?.wordTimings?.[0].start).toBe(4);
});
