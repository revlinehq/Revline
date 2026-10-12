import { expect, it } from 'vitest';
import { formatTime } from './types';

it('keeps a frame boundary accurate after the composition clock rounds its seconds', () => {
 expect(formatTime(1.0333333,true,30)).toBe('00:01:01');
 expect(formatTime(2.0666667,true,30)).toBe('00:02:02');
 expect(formatTime(59.99999997,true,30)).toBe('01:00:00');
});

it('keeps genuinely earlier times on their current frame', () => {
 expect(formatTime(1.033,true,30)).toBe('00:01:00');
 expect(formatTime(1.999,true,30)).toBe('00:01:29');
 expect(formatTime(61.5,false)).toBe('01:01');
});
