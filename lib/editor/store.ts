import { createStore } from 'zustand/vanilla';
import { normalizeTimeline, type Timeline } from './types';
import { reconcileTransitionEdits } from './clip-transitions';
import { equalTimelineValue } from './timeline-equality';

export type EditorState = {
  timeline: Timeline; history: Timeline[]; future: Timeline[];
  selectedId: string | null; selectedIds:string[]; playhead: number; playing: boolean; muted: boolean;
  zoom: number; snapping: boolean; compactTracks:boolean; timelineCollapsed:boolean; scrubbing:boolean;
  edit: (next: Timeline) => void;
  replace: (next: Timeline, remember?: boolean | Timeline[]) => void;
  recover: (next: Timeline) => void;
  undo: () => Timeline | null;
  redo: () => Timeline | null;
  beginUndoGroup: (key: string) => void;
  endUndoGroup: () => void;
};

// One store per open project. Convex remains the source for saved revisions.
export function createEditorStore(timeline: Timeline, history: Timeline[] = []) {
  let undoGroup: { key: string; recorded: boolean } | null = null;
  timeline = normalizeTimeline(timeline);
  const selectionFor=(next:Timeline,state:Pick<EditorState,'selectedId'|'selectedIds'>)=>{
    const ids=new Set(next.clips.map(clip=>clip.id));
    const selectedIds=state.selectedIds.filter(id=>ids.has(id));
    return {selectedIds,selectedId:state.selectedId&&ids.has(state.selectedId)?state.selectedId:selectedIds.at(-1)??null};
  };
  return createStore<EditorState>()((set, get) => ({
    timeline, history: history.slice(-40).map(normalizeTimeline), future: [], selectedId: null, selectedIds:[], playhead: 0, playing: false, muted: false, zoom: 1, snapping: true, compactTracks:false,timelineCollapsed:false,scrubbing:false,
    beginUndoGroup: key => { if (undoGroup?.key !== key) undoGroup = { key, recorded: false }; },
    endUndoGroup: () => { undoGroup = null; },
    edit: input => { const next=reconcileTransitionEdits(get().timeline,normalizeTimeline(input)); const grouped=undoGroup?.recorded; if(undoGroup)undoGroup.recorded=true; set(s => ({ timeline: next, history: grouped ? s.history : [...s.history.slice(-39), s.timeline], future: [],...selectionFor(next,s) })); },
    // Remote snapshots carry the server's undo groups, rather than one entry per streamed tool call.
    replace: (input, remember = false) => { const current=get().timeline, normalized=normalizeTimeline(input), next=equalTimelineValue(current,normalized)?current:normalized; set(s => ({ timeline: next,...selectionFor(next,s), ...(Array.isArray(remember) ? {history:remember.slice(-40).map(normalizeTimeline),future:[]} : remember && next!==current ? { history: [...s.history.slice(-39), s.timeline], future: [] } : {}) })); },
    recover: input => { undoGroup=null;const next=normalizeTimeline(input); set({ timeline: next, history: [], future: [], selectedId: null, selectedIds:[] }); },
    undo: () => {
      undoGroup=null;
      const { history, timeline, future } = get(); const previous = history.at(-1);
      if (!previous) return null;
      set({ timeline: previous, history: history.slice(0, -1), future: [...future, timeline],...selectionFor(previous,get()) }); return previous;
    },
    redo: () => {
      undoGroup=null;
      const { history, timeline, future } = get(); const next = future.at(-1);
      if (!next) return null;
      set({ timeline: next, history: [...history, timeline], future: future.slice(0, -1),...selectionFor(next,get()) }); return next;
    },
  }));
}
export type EditorStore = ReturnType<typeof createEditorStore>;
