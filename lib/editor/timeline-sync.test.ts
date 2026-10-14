import { describe, expect, it, vi } from 'vitest';
import { applyTimelineEdit, createTimelineSaveQueue, type TimelineSnapshot } from './timeline-sync';
import type { Timeline } from './types';
import { deleteEmptyLayer, moveSelectedClips } from './timeline-controls';
import { createEditorStore } from './store';
import { matchesUndoSnapshot } from '../../components/editor/assistant-results';

const base: Timeline = {
  fps: 30, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 1, effects:0 },
  clips: [{ id: 'caption', kind: 'caption', track: 2, start: 0, duration: 3, sourceStart: 0, text: 'Original', fontSize: 32 }],
};
const patch = (value: Partial<Timeline['clips'][number]>): Timeline => ({ ...base, clips: [{ ...base.clips[0], ...value }] });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe('manual edit intent', () => {
  it('rebases FX movement and row deletion without losing concurrent video edits or new effects', () => {
    const before:Timeline={...base,tracks:{visual:2,overlay:0,audio:1,effects:3},clips:[...base.clips,
      {id:'flash',kind:'effect',track:1,start:1,duration:.5,sourceStart:0,effectPreset:'flash'},
      {id:'bars',kind:'effect',track:3,start:2,duration:2,sourceStart:0,effectPreset:'cinematic-bars'},
    ]};
    const local=moveSelectedClips(deleteEmptyLayer(before,'effects',2),['bars'],1,0);
    const remote:Timeline={...before,clips:[{...before.clips[0],text:'Concurrent text'},...before.clips.slice(1),{id:'new',kind:'effect',track:4,start:6,duration:1,sourceStart:0,effectPreset:'punch'}]};
    const merged=applyTimelineEdit(before,local,remote);
    expect(merged.clips[0]).toMatchObject({text:'Concurrent text',track:2});
    expect(merged.clips[1]).toEqual(before.clips[1]);expect(merged.clips[2]).toMatchObject({track:2,start:3,duration:2,effectPreset:'cinematic-bars'});
    expect(merged.clips[3]).toEqual(remote.clips[3]);expect(merged.tracks).toEqual({visual:2,overlay:0,audio:1,effects:4});
  });
  it('merges marker additions, movement and deletion without reviving remotely deleted markers', () => {
    const before: Timeline = { ...base, markers: [{ id: 'a', time: 1 }, { id: 'b', time: 2 }] };
    const local: Timeline = { ...before, markers: [{ id: 'a', time: 3 }, { id: 'local', time: 4 }] };
    const remote: Timeline = { ...before, markers: [{ id: 'b', time: 2 }, { id: 'remote', time: 5 }] };
    expect(applyTimelineEdit(before, local, remote).markers).toEqual([{ id: 'remote', time: 5 }, { id: 'local', time: 4 }]);
  });
  it('preserves live added clips and styling while moving an existing clip', () => {
    const current: Timeline = { ...patch({ fontSize: 48 }), tracks: { visual: 3, overlay: 0, audio: 1 }, clips: [...patch({ fontSize: 48 }).clips, { ...base.clips[0], id: 'ai-title', kind: 'graphic', track: 3 }] };
    const next = applyTimelineEdit(base, patch({ start: 2 }), current);
    expect(next.clips[0]).toMatchObject({ start: 2, fontSize: 48 });
    expect(next.clips[1]).toEqual(current.clips[1]);
    expect(next.tracks?.visual).toBe(3);
  });
  it('keeps manual field precedence, trims consistent, and remote deletion permanent', () => {
    expect(applyTimelineEdit(base, patch({ text: 'Human' }), patch({ text: 'Claude', fontSize: 48 })).clips[0]).toMatchObject({ text: 'Human', fontSize: 48 });
    expect(applyTimelineEdit(base, patch({ duration: 2 }), patch({ sourceStart: 1 })).clips[0]).toMatchObject({ duration: 2, sourceStart: 0 });
    expect(applyTimelineEdit(base, patch({ start: 1 }), { ...base, clips: [] }).clips).toEqual([]);
  });
  it('merges independent transform fields and supports clearing visual overrides', () => {
    const transform = { x: .5, y: .5, scale: 1, rotation: 0, opacity: 1 };
    const before: Timeline = { ...base, clips: [{ ...base.clips[0], kind: 'image', assetId: 'image', text: undefined, transform, fit: 'contain' }] };
    const local: Timeline = { ...before, clips: [{ ...before.clips[0], transform: { ...transform, x: .6 }, fit: undefined }] };
    const remote: Timeline = { ...before, clips: [{ ...before.clips[0], transform: { ...transform, opacity: .8 } }] };
    expect(applyTimelineEdit(before, local, remote).clips[0]).toMatchObject({ transform: { ...transform, x: .6, opacity: .8 } });
    expect(applyTimelineEdit(before, local, remote).clips[0]).not.toHaveProperty('fit');
  });
});

describe('timeline save queue', () => {
  it('keeps streamed AI checkpoints in the server undo group, including a later manual edit', () => {
    const store=createEditorStore(base);
    const queue=createTimelineSaveQueue({timeline:base,revision:1},{save:vi.fn(),load:vi.fn(),saving:vi.fn(),error:vi.fn(),update:(next,kind,history?:Timeline[])=>store.getState().replace(next,kind==='remote'?history??true:false)});
    const intermediate=patch({color:'#FFFFFF'}),final=patch({color:'#FFFFFF',fontSize:80});
    queue.receive({timeline:intermediate,revision:2,history:[base]});
    queue.receive({timeline:final,revision:3,history:[base]});
    expect(matchesUndoSnapshot({before:base,after:final},store.getState().timeline,store.getState().history.at(-1))).toBe(true);
    expect(store.getState().undo()).toEqual(base);
    expect(store.getState().redo()).toEqual(final);
    const manual={...final,clips:final.clips.map(clip=>({...clip,text:'Manual correction'}))};
    store.getState().edit(manual);
    const nextAI={...manual,clips:manual.clips.map(clip=>({...clip,fontSize:100}))};
    queue.receive({timeline:nextAI,revision:5,history:[base,final,manual]});
    expect(store.getState().undo()).toEqual(manual);
    expect(store.getState().undo()).toEqual(final);
    expect(store.getState().undo()).toEqual(base);
  });
  it('rebases queued rapid gestures onto the canonical acknowledgement including Claude edits', async () => {
    const first = deferred<TimelineSnapshot>();
    const update = vi.fn(), saving = vi.fn(), error = vi.fn();
    const save = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(async edit => ({ timeline: edit.timeline, revision: 4 }));
    const queue = createTimelineSaveQueue({ timeline: base, revision: 1 }, { save, update, saving, error, load: vi.fn() });
    queue.edit(patch({ start: 1 }));
    queue.edit(patch({ start: 2 }));
    queue.edit(patch({ start: 2, text: 'Latest gesture' }));
    first.resolve({ timeline: patch({ start: 1, fontSize: 48 }), revision: 3 });
    await queue.wait();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ expectedRevision: 3, baseTimeline: patch({ start: 1, fontSize: 48 }), timeline: patch({ start: 2, text: 'Latest gesture', fontSize: 48 }) });
    expect(update).toHaveBeenLastCalledWith(patch({ start: 2, text: 'Latest gesture', fontSize: 48 }), 'saved');
    expect(saving.mock.calls).toEqual([[true], [false]]);
    expect(error).not.toHaveBeenCalled();
  });
  it('adopts a newer live revision received while saving and ignores late old echoes', async () => {
    const first = deferred<TimelineSnapshot>(), update = vi.fn();
    const queue = createTimelineSaveQueue({ timeline: base, revision: 1 }, { save: () => first.promise, load: vi.fn(), update, saving: vi.fn(), error: vi.fn() });
    queue.edit(patch({ start: 1 }));
    queue.receive({ timeline: patch({ start: 1, fontSize: 48 }), revision: 3 });
    first.resolve({ timeline: patch({ start: 1 }), revision: 2 });
    await queue.wait();
    expect(update).toHaveBeenLastCalledWith(patch({ start: 1, fontSize: 48 }), 'remote');
    const calls = update.mock.calls.length;
    queue.receive({ timeline: base, revision: 1 });
    expect(update).toHaveBeenCalledTimes(calls);
  });
  it('clears the busy state and resolves waiters even if saving and recovery both fail', async () => {
    const error = vi.fn(), saving = vi.fn();
    const queue = createTimelineSaveQueue({ timeline: base, revision: 1 }, { save: async () => { throw new Error('Network unavailable'); }, load: async () => { throw new Error('Still offline'); }, update: vi.fn(), saving, error });
    queue.edit(patch({ start: 1 }));
    await queue.wait();
    expect(queue.busy).toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
    expect(saving).toHaveBeenLastCalledWith(false);
  });
});
