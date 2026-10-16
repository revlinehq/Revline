import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamDemoText } from './scripted-demo-chat';

afterEach(() => vi.useRealTimers());

describe('scripted demo narration', () => {
  it('streams words over time while preserving the complete reply', async () => {
    vi.useFakeTimers();
    const chunks: string[] = [];
    const finished = streamDemoText('Building cuts, captions, and sound. Ready to play.', new AbortController().signal, chunk => chunks.push(chunk));
    expect(chunks).toEqual([]);
    await vi.advanceTimersByTimeAsync(180);
    expect(chunks.join('')).toBe('Building ');
    await vi.advanceTimersByTimeAsync(500);
    expect(chunks.join('')).not.toContain('Ready');
    await vi.runAllTimersAsync();
    await finished;
    expect(chunks.join('')).toBe('Building cuts, captions, and sound. Ready to play.');
    expect(chunks.length).toBe(8);
  });

  it('cancels pending text on Stop, reset, or unmount without leaving timers', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(), chunks: string[] = [];
    const finished = streamDemoText('Building the next part of your edit.', controller.signal, chunk => chunks.push(chunk));
    const rejected = expect(finished).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(180);
    controller.abort();
    await rejected;
    await vi.runAllTimersAsync();
    expect(chunks).toEqual(['Building ']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
