import { expect, test } from 'vitest';
import { addTimelineMarker, moveTimelineMarker, removeTimelineMarker, removeTimelineMarkers } from './timeline-markers';
import { EMPTY_TIMELINE, timelineDuration, type Timeline } from './types';
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

test('explicit free cues retain user labels or remain unlabeled without claiming measured beats',()=>{
  const labeled=addTimelineMarker(EMPTY_TIMELINE,1.19,'cue','Start title');
  const unlabelled=addTimelineMarker(labeled,2,'free',null);
  expect(unlabelled.markers).toEqual([{id:'cue',time:1.2,label:'Start title'},{id:'free',time:2}]);
  expect(moveTimelineMarker(unlabelled,'cue',3.19).markers?.[0]).toEqual({id:'cue',time:3.2,label:'Start title'});
  expect(()=>addTimelineMarker(EMPTY_TIMELINE,1,'invalid','x'.repeat(121))).toThrow('1–120');
  expect(()=>addTimelineMarker(EMPTY_TIMELINE,1,'invalid',' ')).toThrow('1–120');
});

const withMarkers: Timeline = {
  ...EMPTY_TIMELINE,
  clips: [{ id: 'caption', kind: 'caption', track: 1, start: 0, duration: 5, sourceStart: 0, text: 'Keep this' }],
  markers: [{ id: 'beat-1', time: 1 }, { id: 'manual', time: 2, label: 'My cue' }, { id: 'beat-2', time: 3, label: 'Beat 1' }],
};

test('marker removal uses IDs even without labels, preserves other cues and never changes clips', () => {
  const one = removeTimelineMarker(withMarkers, 'beat-1');
  expect(one.markers).toEqual(withMarkers.markers!.slice(1));
  expect(one.clips).toBe(withMarkers.clips);
  const selected = removeTimelineMarkers(withMarkers, ['beat-1', 'beat-1', 'beat-2', 'missing']);
  expect(selected.markers).toEqual([withMarkers.markers![1]]);
  expect(selected.clips).toBe(withMarkers.clips);
  expect(removeTimelineMarker(withMarkers, 'My cue')).toBe(withMarkers);
  expect(removeTimelineMarkers(withMarkers, [])).toBe(withMarkers);
});

test('clearing markers removes all cues, and repeat clears are identity-preserving no-ops', () => {
  const cleared = removeTimelineMarkers(withMarkers);
  expect(cleared.markers).toEqual([]);
  expect(cleared.clips).toBe(withMarkers.clips);
  expect(removeTimelineMarkers(cleared)).toBe(cleared);
  expect(removeTimelineMarkers(EMPTY_TIMELINE)).toBe(EMPTY_TIMELINE);
});

test('clearing all markers has one undo and redo restores the cleared state', () => {
  const store = createEditorStore(withMarkers);
  const original = store.getState().timeline;
  store.getState().edit(removeTimelineMarkers(original));
  expect(store.getState().timeline.markers).toEqual([]);
  expect(store.getState().undo()).toEqual(original);
  expect(store.getState().redo()?.markers).toEqual([]);
  expect(store.getState().timeline.clips).toEqual(original.clips);
});
