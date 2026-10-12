import { describe, it, expect } from 'vitest';
import { createEditorStore } from './store';
import { EMPTY_TIMELINE } from './types';

describe('project editor history',()=>{
  it('keeps project state isolated and handles edits after remote AI revisions',()=>{
    const a=createEditorStore(EMPTY_TIMELINE),b=createEditorStore(EMPTY_TIMELINE);
    const first={...EMPTY_TIMELINE,aspectRatio:'square' as const};a.getState().edit(first);
    const ai={...first,fps:24};a.getState().replace(ai,true);
    expect(a.getState().undo()).toEqual(first);expect(a.getState().redo()).toEqual(ai);
    a.getState().undo();a.getState().edit({...first,fps:60});
    expect(a.getState().redo()).toBeNull();expect(b.getState().timeline).toEqual(EMPTY_TIMELINE);
  });
  it('recovers from rejected saves without leaving invalid undo entries',()=>{
    const store=createEditorStore(EMPTY_TIMELINE);store.getState().edit({...EMPTY_TIMELINE,fps:60});
    store.setState({selectedId:'deleted'});store.getState().recover(EMPTY_TIMELINE);
    expect(store.getState().undo()).toBeNull();expect(store.getState().selectedId).toBeNull();
  });
  it('drops deleted selections and keeps remaining selections after edits, remote replacements and undo',()=>{
    const clip={id:'one',kind:'image' as const,start:0,duration:1,sourceStart:0};
    const original={...EMPTY_TIMELINE,clips:[clip]};
    for(const update of ['edit','replace'] as const){
      const store=createEditorStore(original);
      store.setState({selectedId:'two',selectedIds:['one','two']});
      store.getState()[update](original);
      expect(store.getState().selectedIds).toEqual(['one']);
      expect(store.getState().selectedId).toBe('one');
    }
    const store=createEditorStore(original);
    store.getState().edit({...original,clips:[clip,{...clip,id:'two',start:1}]});
    store.setState({selectedId:'two',selectedIds:['two']});
    store.getState().undo();
    expect(store.getState().selectedIds).toEqual([]);
    expect(store.getState().selectedId).toBeNull();
    store.getState().redo();
    expect(store.getState().selectedIds).toEqual([]);
  });
});
