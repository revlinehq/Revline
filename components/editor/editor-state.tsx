'use client';
import { createContext, useContext, useRef } from 'react';
import { useStore } from 'zustand';
import type { EditorState, EditorStore } from '@/lib/editor/store';

const Context = createContext<EditorStore | null>(null);
export function EditorStateProvider({store,children}:{store:EditorStore;children:React.ReactNode}) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useEditorStore() {
  const store=useContext(Context);
  if(!store)throw new Error('Editor state requires a project store.');
  return store;
}
export function useEditorState<T>(selector:(state:EditorState)=>T) {
  return useStore(useEditorStore(),selector);
}

/** React owns parked values; live readouts paint directly from the player clock. */
export function usePausedPlaybackTime() {
  const store=useEditorStore();
  const time=useStore(store,state=>state.playing?null:state.playhead);
  const paused=useRef(store.getState().playhead);
  if(time!==null)paused.current=time;
  return paused.current;
}

/** Inspector controls settle once after a scrub instead of rendering each tick. */
export function useInspectorPlaybackTime() {
  const store=useEditorStore();
  const time=useStore(store,state=>state.playing||state.scrubbing?null:state.playhead);
  const settled=useRef(store.getState().playhead);
  if(time!==null)settled.current=time;
  return settled.current;
}
