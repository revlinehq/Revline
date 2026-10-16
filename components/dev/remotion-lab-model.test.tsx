import { describe, expect, it } from 'vitest';
import { alignLabItems, DEFAULT_LAB_CONFIG, labProgress, labTemplateFile, parseLabConfig, parseLabFile, retimeWords } from './remotion-lab-model';

describe('Remotion development compositions', () => {
  it('keeps timed reveals hidden before a cue and supports real overshoot', () => {
    const config = { ...DEFAULT_LAB_CONFIG, damping: 4 };
    expect(labProgress(config, 53, 1.8)).toEqual(0);
    expect(labProgress(config, 54, 1.8)).toEqual(0);
    expect(labProgress(config, 60, 1.8)).toBeGreaterThan(0);
    expect(Array.from({ length: 30 }, (_, frame) => labProgress(config, frame)).some(value => value > 1)).toBe(true);
    expect(labProgress({ ...config, motion: 'linear' }, 300)).toEqual(1);
  });

  it('uses transcript word timestamps for matching card triggers', () => {
    const config = { ...DEFAULT_LAB_CONFIG, items: DEFAULT_LAB_CONFIG.items.map(item => ({ ...item, start: 0 })) };
    expect(alignLabItems(config).map(item => item.start)).toEqual([1.8, 3.2, 4.8]);
    const words = retimeWords('An editable sample sentence', 4);
    expect(words).toHaveLength(4);
    expect(words.every((word, i) => word.end >= word.start && (!i || word.start >= words[i - 1].end))).toBe(true);
    expect(words.at(-1)!.end).toBeLessThanOrEqual(4);
  });

  it('round-trips templates while rejecting malformed timelines and unsafe values', () => {
    expect(parseLabFile(labTemplateFile(DEFAULT_LAB_CONFIG))).toEqual(DEFAULT_LAB_CONFIG);
    const million = { ...DEFAULT_LAB_CONFIG, items: DEFAULT_LAB_CONFIG.items.map(item => ({ ...item, value: 14_000_000 })) };
    expect(parseLabConfig(million).items[0].value).toEqual(14_000_000);
    for (const patch of [{ fps: '30' }, { fps: 0 }, { duration: NaN }, { blur: Infinity }, { accent: 'url(https://example.com)' }, { words: [{ word: 'bad', start: 2, end: 1 }] }, { words: [{ word: 'one', start: 0, end: 2 }, { word: 'two', start: 1, end: 3 }] }]) {
      expect(() => parseLabConfig({ ...DEFAULT_LAB_CONFIG, ...patch })).toThrow();
    }
    expect(() => parseLabFile({ version: 2, config: DEFAULT_LAB_CONFIG })).toThrow();
  });
});
