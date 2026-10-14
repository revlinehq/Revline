import { createStore } from 'zustand/vanilla';
import { normalizeTimeline, type Timeline } from './types';
import { reconcileTransitionEdits } from './clip-transitions';

export type EditorState = {
  timeline: Timeline; history: Timeline[]; future: Timeline[];
  selectedId: string | null; selectedIds:string[]; playhead: number; playing: boolean; muted: boolean;
  zoom: number; snapping: boolean; compactTracks:boolean; timelineCollapsed:boolean;
  edit: (next: Timeline) => void;
  replace: (next: Timeline, remember?: boolean | Timeline[]) => void;
  recover: (next: Timeline) => void;
  undo: () => Timeline | null;
  redo: () => Timeline | null;
};

// One store per open project. Convex remains the source for saved revisions.
export function createEditorStore(timeline: Timeline, history: Timeline[] = []) {
  timeline = normalizeTimeline(timeline);
  const selectionFor=(next:Timeline,state:Pick<EditorState,'selectedId'|'selectedIds'>)=>{
    const ids=new Set(next.clips.map(clip=>clip.id));
    const selectedIds=state.selectedIds.filter(id=>ids.has(id));
    return {selectedIds,selectedId:state.selectedId&&ids.has(state.selectedId)?state.selectedId:selectedIds.at(-1)??null};
  };
  return createStore<EditorState>()((set, get) => ({
    timeline, history: history.slice(-40).map(normalizeTimeline), future: [], selectedId: null, selectedIds:[], playhead: 0, playing: false, muted: false, zoom: 1, snapping: true, compactTracks:false,timelineCollapsed:false,
    edit: input => { const next=reconcileTransitionEdits(get().timeline,normalizeTimeline(input)); set(s => ({ timeline: next, history: [...s.history.slice(-39), s.timeline], future: [],...selectionFor(next,s) })); },
    // Remote snapshots carry the server's undo groups, rather than one entry per streamed tool call.
    replace: (input, remember = false) => { const next=normalizeTimeline(input); set(s => ({ timeline: next,...selectionFor(next,s), ...(Array.isArray(remember) ? {history:remember.slice(-40).map(normalizeTimeline),future:[]} : remember ? { history: [...s.history.slice(-39), s.timeline], future: [] } : {}) })); },
    recover: input => { const next=normalizeTimeline(input); set({ timeline: next, history: [], future: [], selectedId: null, selectedIds:[] }); },
    undo: () => {
      const { history, timeline, future } = get(); const previous = history.at(-1);
      if (!previous) return null;
      set({ timeline: previous, history: history.slice(0, -1), future: [...future, timeline],...selectionFor(previous,get()) }); return previous;
    },
    redo: () => {
      const { history, timeline, future } = get(); const next = future.at(-1);
      if (!next) return null;
      set({ timeline: next, history: [...history, timeline], future: future.slice(0, -1),...selectionFor(next,get()) }); return next;
    },
  }));
}
export type EditorStore = ReturnType<typeof createEditorStore>;
