import { expect, test } from 'vitest';
import { EditSession } from './lib/editSession';
import { patchClip } from '../lib/editor/operations';
import type { Timeline } from '../lib/editor/types';

// Sanitized order-15 replay: four graphic labels, eight appearance receipts,
// revisions 27 through 35, followed by the existing 15-step stop. No user media.
const timeline: Timeline = { fps: 30, aspectRatio: 'landscape', clips: Array.from({ length: 4 }, (_, index) => ({ id: `title-${index}`, kind: 'graphic', text: `${index + 1}) UPPERCASE LABEL`, start: index * 3, duration: 3, sourceStart: 0, fontFamily: 'space-grotesk', background: '#000000' })) };
test('step cap after eight immediate saves reports partial completion without inventing a replacement', async () => {
  let saved = timeline, revision = 27;
  const session = new EditSession(timeline, revision, { apply: async next => { saved = next; return ++revision; }, validate: async () => { throw new Error('This appearance request has no staged draft'); } });
  for (const clip of timeline.clips) {
    await session.checkpoint(t => patchClip(t, clip.id, { fontFamily: 'poppins', background: 'transparent' }));
    await session.checkpoint(t => patchClip(t, clip.id, { textStyle: { strokeWidth: 3, strokeColor: '#000000', shadowBlur: 0, shadowX: 0, shadowY: 0, shadowColor: '#000000', glowBlur: 0, glowColor: '#ffffff' } }));
  }
  expect(session.savedEdits).toBe(8); expect(revision).toBe(35); expect(session.staged).toBe(false);
  await expect(session.complete('tool-calls')).rejects.toThrow(/saved changes remain|saved edits remain/i);
  await expect(session.complete('tool-calls')).rejects.not.toThrow(/pending replacement/i);
  expect(saved.clips.every(clip => clip.background === 'transparent')).toBe(true);
  expect(saved.clips[0].text).toBe('1) UPPERCASE LABEL'); // Requested casing still unfinished.
});
