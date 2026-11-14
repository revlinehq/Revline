import { createStore } from 'zustand/vanilla';
import { normalizeTimeline, type Timeline } from './types';
import { reconcileTransitionEdits } from './clip-transitions';
import { snapTimelineToFrames } from './frame-grid';
import { equalTimelineValue } from './timeline-equality';
import { LOCAL_UNDO_LIMIT } from './timeline-history-key';
import { readStoredPreference, writeStoredPreference } from '@/lib/stored-preference';

export type EditorState = {
  timeline: Timeline; history: Timeline[]; future: Timeline[];
  selectedId: string | null; selectedIds:string[]; playhead: number; playing: boolean; muted: boolean;
  zoom: number; snapping: boolean; ripple: boolean; tool:'select'|'blade'; /** 'auto' compacts rows only when the layers don't fit the timeline's height; true/false is the user's choice. */
  compactTracks:boolean|'auto'; timelineCollapsed:boolean; scrubbing:boolean;
  /** Drawing blur regions on this clip in the preview, and the region the inspector edits (lib/editor/blur-regions.ts). */
  regionEdit:{clipId:string;index:number|null}|null;
  edit: (next: Timeline) => void;
  replace: (next: Timeline, remember?: boolean | Timeline[]) => void;
  recover: (next: Timeline) => void;
  undo: () => Timeline | null;
  redo: () => Timeline | null;
  beginUndoGroup: (key: string) => void;
  endUndoGroup: () => void;
};

const RIPPLE_STORAGE_KEY = 'revline-timeline-ripple';
/** Auto-join is a personal editing preference, so it survives reloads and projects. */
function savedRipple() { return readStoredPreference(RIPPLE_STORAGE_KEY) === 'true'; }
/** The toggle still applies to this session when storage is unavailable. */
export function setRipplePreference(on: boolean) { writeStoredPreference(RIPPLE_STORAGE_KEY, String(on)); }

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
    timeline, history: history.slice(-LOCAL_UNDO_LIMIT).map(normalizeTimeline), future: [], selectedId: null, selectedIds:[], regionEdit:null, playhead: 0, playing: false, muted: false, zoom: 1, snapping: true, ripple: savedRipple(), tool:'select', compactTracks:'auto',timelineCollapsed:true,scrubbing:false,
    beginUndoGroup: key => { if (undoGroup?.key !== key) undoGroup = { key, recorded: false }; },
    endUndoGroup: () => { undoGroup = null; },
    // A gesture writes the timeline: its cuts land on the frame grid here (lib/editor/frame-grid.ts).
    edit: input => { const next=snapTimelineToFrames(reconcileTransitionEdits(get().timeline,normalizeTimeline(input)),undefined,get().timeline).timeline; const grouped=undoGroup?.recorded; if(undoGroup)undoGroup.recorded=true; set(s => ({ timeline: next, history: grouped ? s.history : [...s.history.slice(1-LOCAL_UNDO_LIMIT), s.timeline], future: [],...selectionFor(next,s) })); },
    // Remote snapshots carry the server's undo groups, rather than one entry per streamed tool call.
    replace: (input, remember = false) => { const current=get().timeline, normalized=normalizeTimeline(input), next=equalTimelineValue(current,normalized)?current:normalized; set(s => ({ timeline: next,...selectionFor(next,s), ...(Array.isArray(remember) ? {history:remember.slice(-LOCAL_UNDO_LIMIT).map(normalizeTimeline),future:[]} : remember && next!==current ? { history: [...s.history.slice(1-LOCAL_UNDO_LIMIT), s.timeline], future: [] } : {}) })); },
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
