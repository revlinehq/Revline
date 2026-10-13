import { expect, test } from 'vitest';
import { addTimelineMarker, moveTimelineMarker, removeTimelineMarker } from './timeline-markers';
import { EMPTY_TIMELINE, timelineDuration } from './types';
import { createEditorStore } from './store';

test('markers align to frames, avoid duplicate marks, and remain independent of clip duration', () => {
  const marked = addTimelineMarker(EMPTY_TIMELINE, 600.049, 'drop');
  expect(marked.markers).toEqual([{ id: 'drop', time: 600 + 1 / 30, label: 'Beat 1' }]);
  expect(addTimelineMarker(marked, 600.04, 'duplicate')).toBe(marked);
  expect(moveTimelineMarker(marked, 'drop', -1).markers?.[0].time).toBe(0);
  expect(timelineDuration(marked)).toBe(0);
  expect(removeTimelineMarker(marked, 'drop').markers).toEqual([]);
});

test('marker edits participate in undo and redo without touching the clips', () => {
  const store = createEditorStore(EMPTY_TIMELINE);
  const marked = addTimelineMarker(EMPTY_TIMELINE, 1.01, 'drop');
  store.getState().edit(marked);
  store.getState().edit(moveTimelineMarker(marked, 'drop', 2));
  expect(store.getState().undo()?.markers?.[0].time).toBe(1);
  expect(store.getState().redo()?.markers?.[0].time).toBe(2);
  expect(store.getState().timeline.clips).toEqual([]);
});
