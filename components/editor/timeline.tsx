'use client';
import { useState, useRef, useCallback, useLayoutEffect, useEffect, useMemo } from 'react';
import { Scissors, Copy, ClipboardPaste, Trash2, Magnet, Minus, Plus, Type, Layers, Volume2, VolumeX, ChevronDown, ChevronUp, MoreHorizontal, Rows3, ListMinus, Unlink } from 'lucide-react';
import { IconButton } from './primitives';
import { TimelineRulerTicks } from './timeline-ruler';
import { EditorPlaybackTime } from './playback-time';
import { MediaFilmstrip } from './media-filmstrip';
import { AudioWaveform } from './audio-waveform';
import { useEditorState, useEditorStore, usePausedPlaybackTime } from './editor-state';
import { paintPlayhead, useTimelinePlayhead, useEdgeAutoScroll } from './use-timeline-playhead';
import { deriveTrackCounts, layerGroup, trackOf, clipColor, timelineDuration, formatTime, maxTrackCount, type Timeline, type MediaAsset, type Clip, type LayerGroup } from '@/lib/editor/types';
import { snapTime, addMediaClip, addTextClip, splitClip, frameSeekTime, linkedClipIds, unlinkClips, patchClip } from '@/lib/editor/operations';
import { timelineLayout, TIMELINE_RULER_HEIGHT, TIMELINE_ORIGIN, TIMELINE_TOP_SPACE, TIMELINE_BOTTOM_SPACE } from '@/lib/editor/timeline-layout';
import { clipVolumeAtPointer, clipVolumeAtFraction, MAX_CLIP_VOLUME } from '@/lib/editor/clip-volume';
import { zoomAtAnchor, reorderLayer, deleteEmptyLayer, removeEmptyLayers, resizeSelectedClips,moveSelectedClips,moveSelectionToNewLayers,layerDropTarget,clipLayerDropTarget,intersectsSelection,shouldCommitClipGesture,isDoubleTimelineTap,timelineTimeAtPointer,type TimelineTap } from '@/lib/editor/timeline-controls';
import { isTimelineGestureRejection, TimelineGestureRejection } from '@/lib/editor/timeline-edit-errors';
import { timelineGestureFrame } from '@/lib/editor/timeline-gesture-frame';
import './custom-timeline.css';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from '@/components/ui/context-menu';

type Props={
  timeline:Timeline;assets:MediaAsset[];selected:string|null;onSelect:(id:string|null)=>void;
  time:number;playing:boolean;readPlaybackTime?:()=>number;onSeek:(time:number)=>void;onChange:(timeline:Timeline)=>void;
  onSplit:()=>void;onDelete:()=>void;onDuplicate:()=>void;onAddText:(kind:'caption'|'graphic')=>void;
  onCopy?:()=>void;onPaste?:(time?:number)=>void;canPaste?:boolean;
  onTogglePlay?:()=>void;muted?:boolean;onToggleMute?:()=>void;
  playbackControls?:React.ReactNode;
  onPreviewVolume?:(id:string,volume:number|null)=>void;
  onEditText?:(id:string)=>void;onError?:(message:string)=>void;collapsed?:boolean;onToggleCollapse?:()=>void;
};

function watchCancellation(cancel: () => void) {
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); cancel();
  };
  window.addEventListener('keydown', key, true);
  window.addEventListener('blur', cancel);
  return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); };
}

function TimelinePlayheadClock(props: Omit<Parameters<typeof useTimelinePlayhead>[0], 'time'>) {
  const time=usePausedPlaybackTime();
  useTimelinePlayhead({...props,time});
  return null;
}

export function TimelinePanel(p:Props){
  const {timeline,assets,selected,onSelect,time,onSeek,onChange}=p;
  const store=useEditorStore();const zoom=useEditorState(s=>s.zoom);const snap=useEditorState(s=>s.snapping);const dense=useEditorState(s=>s.compactTracks);const RULER_HEIGHT=TIMELINE_RULER_HEIGHT;const origin=TIMELINE_ORIGIN;
  const selectedIds=useEditorState(s=>s.selectedIds);const selectionBox=useRef<HTMLDivElement>(null);const [selecting,setSelecting]=useState(false);
  const linkedSelection=useMemo(()=>new Set(linkedClipIds(timeline,selectedIds.length?selectedIds:selected?[selected]:[])),[timeline,selectedIds,selected]);
  const [drag,setDrag]=useState<Clip|null>(null);const [insertion,setInsertion]=useState<{group:LayerGroup;edge:'above'|'below';track?:number}|null>(null);const [layerDrop,setLayerDrop]=useState<string|null>(null);const [movingLayer,setMovingLayer]=useState<string|null>(null);const [scrubbing,setScrubbing]=useState(false);
  const [viewportHeight,setViewportHeight]=useState(0);const [scrollbarHeight,setScrollbarHeight]=useState(0);
  const [context,setContext]=useState<{clipId?:string;group?:LayerGroup;track?:number;time:number}|null>(null);
  const scroll=useRef<HTMLDivElement>(null);const labels=useRef<HTMLDivElement>(null);const head=useRef<HTMLDivElement>(null);const cap=useRef<HTMLDivElement>(null);
  const previews=useRef<HTMLDivElement>(null);const activeMode=useRef<'move'|'left'|'right'>('move');const lastTap=useRef<TimelineTap|null>(null);
  const gestureCleanup=useRef<(()=>void)|null>(null);
  const gestureUpdate=useRef<(()=>void)|null>(null);
  const volumesBeforeMute=useRef(new Map<string,number>());
  useEffect(()=>()=>gestureCleanup.current?.(),[]);
  useEffect(()=>{gestureCleanup.current?.();lastTap.current=null;},[timeline]);
  const area=useRef<HTMLDivElement>(null);const scrubRef=useRef(false);const pointerX=useRef(0);const pointerY=useRef(0);const zoomAnchor=useRef<number|null>(null);
  const px=54*zoom;const end=timelineDuration(timeline);const duration=Math.max(15,end+1);const width=Math.max(720,duration*px);
  const layout=useMemo(()=>timelineLayout(timeline,dense),[timeline,dense]);const tracks=layout.tracks;const assetMap=useMemo(()=>new Map(assets.map(a=>[a._id,a])),[assets]);
  useLayoutEffect(()=>{
    const el=scroll.current;if(!el)return;
    const measure=()=>{setViewportHeight(el.clientHeight);setScrollbarHeight(el.offsetHeight-el.clientHeight);};
    const observer=new ResizeObserver(measure);observer.observe(el);if(area.current)observer.observe(area.current);measure();
    return()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{
    if(scroll.current&&labels.current)labels.current.scrollTop=scroll.current.scrollTop;
  },[layout,viewportHeight,scrollbarHeight]);
  const cleanedTimeline=useMemo(()=>removeEmptyLayers(timeline),[timeline]);
  const rowContents=useMemo(()=>tracks.map(track=>`${track.id}:${timeline.clips.filter(c=>layerGroup(c.kind)===track.group&&trackOf(c)===track.number).map(c=>c.id).join(',')}`).join('|'),[tracks,timeline]);
  useLayoutEffect(()=>{
    const el=scroll.current;if(!el||!el.clientHeight||gestureCleanup.current)return;
    const occupied=tracks.flatMap((track,index)=>timeline.clips.some(c=>layerGroup(c.kind)===track.group&&trackOf(c)===track.number)?[index]:[]);
    const selectedClip=timeline.clips.find(c=>c.id===selected);
    const selectedRow=selectedClip?tracks.findIndex(track=>track.group===layerGroup(selectedClip.kind)&&track.number===trackOf(selectedClip)):-1;
    const visible=(row:number)=>tracks[row].top+tracks[row].height>el.scrollTop+RULER_HEIGHT&&tracks[row].top<el.scrollTop+el.clientHeight;
    const target=selectedRow>=0&&!visible(selectedRow)?selectedRow:!occupied.some(visible)?occupied[0]:undefined;
    if(target!==undefined){el.scrollTop=Math.max(0,tracks[target].top-RULER_HEIGHT);if(labels.current)labels.current.scrollTop=el.scrollTop;}
  },[rowContents,selected,viewportHeight,dense]);
  const report=(error:unknown)=>{if(isTimelineGestureRejection(error))return;p.onError?.(error instanceof Error?error.message:'Could not make this edit.');};
  function toggleTrackSound(clips:Clip[]){
    const targets=[...new Map(clips.map(clip=>{const target=clip.kind==='video'&&clip.linkedClipId?timeline.clips.find(c=>c.id===clip.linkedClipId)??clip:clip;return [target.id,target];})).values()];
    if(!targets.length)return;
    const muted=targets.every(clip=>clip.volume===0);
    if(!muted)for(const clip of targets)volumesBeforeMute.current.set(clip.id,clip.volume??1);
    onChange(targets.reduce((next,clip)=>patchClip(next,clip.id,{volume:muted?volumesBeforeMute.current.get(clip.id)??1:0}),timeline));
  }

  useEdgeAutoScroll(scrubbing||selecting||!!drag||!!movingLayer,scroll,pointerX,drag||movingLayer||selecting?pointerY:undefined,gestureUpdate,!movingLayer);
  useLayoutEffect(()=>{if(zoomAnchor.current!==null&&scroll.current){scroll.current.scrollLeft=zoomAnchor.current;zoomAnchor.current=null;}},[zoom]);

  const changeZoom=useCallback((next:number,anchor?:number)=>{
    const value=Math.max(.15,Math.min(4,next));const el=scroll.current;
    if(el){const current=p.readPlaybackTime?.()??store.getState().playhead;const at=anchor??Math.min(el.clientWidth/2,Math.max(0,origin+current*px-el.scrollLeft));zoomAnchor.current=zoomAtAnchor(zoom,value,el.scrollLeft,at-origin);}
    store.setState({zoom:value});
  },[zoom,store,p.readPlaybackTime,px]);
  useEffect(()=>{
    const viewport=scroll.current;const rail=labels.current;if(!viewport||!rail)return;
    const wheel=(event:WheelEvent)=>{
      const unit=event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1;
      if(event.ctrlKey||event.metaKey){
        event.preventDefault();if(gestureCleanup.current)return;
        const anchor=Math.max(0,Math.min(viewport.clientWidth,event.clientX-viewport.getBoundingClientRect().left));
        changeZoom(zoom*Math.exp(-Math.sign(event.deltaY)*Math.min(30,Math.abs(event.deltaY*unit))/300),anchor);
      }else if(rail.contains(event.target as Node)){
        event.preventDefault();
        if(event.shiftKey&&!event.deltaX)viewport.scrollLeft+=event.deltaY*unit;
        else{viewport.scrollLeft+=event.deltaX*unit;viewport.scrollTop+=event.deltaY*unit;}
      }
    };
    viewport.addEventListener('wheel',wheel,{passive:false});rail.addEventListener('wheel',wheel,{passive:false});
    return()=>{viewport.removeEventListener('wheel',wheel);rail.removeEventListener('wheel',wheel);};
  },[changeZoom,zoom]);

  function addLayer(group:LayerGroup){
    const counts=deriveTrackCounts(timeline);const limit=maxTrackCount(group);if(counts[group]>=limit){report(new Error(`This project already has ${limit} layers of that type.`));return;}
    onChange({...timeline,tracks:{...counts,[group]:counts[group]+1}});
  }
  function paint(t:number){paintPlayhead(head.current,origin+t*px,scroll.current,cap.current);}
  function seekAtPointer(x:number,bypassSnap=false){
    const el=scroll.current;if(!el)return;
    const marks=snap&&!bypassSnap?[0,end,...timeline.clips.flatMap(clip=>[clip.start,clip.start+clip.duration])]:undefined;
    const at=timelineTimeAtPointer(x,{left:el.getBoundingClientRect().left,scrollLeft:el.scrollLeft,origin,px,end,fps:timeline.fps,marks});
    paint(at);onSeek(at);
  }
  function finishClipTap(clipId:string,event:PointerEvent){
    const next={clipId,pointerType:event.pointerType,time:performance.now(),x:event.clientX,y:event.clientY};
    const double=isDoubleTimelineTap(lastTap.current,next);lastTap.current=double?null:next;
    if(double)seekAtPointer(event.clientX,event.altKey);
  }
  function startScrub(e:React.PointerEvent<HTMLElement>){
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();
    gestureCleanup.current?.();lastTap.current=null;
    const target=e.currentTarget;target.setPointerCapture(e.pointerId);pointerX.current=e.clientX;
    const originalTime=frameSeekTime(p.readPlaybackTime?.()??time,timeline.fps,end);
    scrubRef.current=true;setScrubbing(true);let frame=0;let last=-1;let bypassSnap=e.altKey;
    const marks=[0,end,...timeline.clips.flatMap(clip=>[clip.start,clip.start+clip.duration])];
    function update(){
      const el=scroll.current;if(!el)return;
      const at=timelineTimeAtPointer(pointerX.current,{left:el.getBoundingClientRect().left,scrollLeft:el.scrollLeft,origin,px,end,fps:timeline.fps,marks:snap&&!bypassSnap?marks:undefined});
      paint(at);if(at!==last){last=at;onSeek(at);}
    }
    function tick(){update();frame=requestAnimationFrame(tick);}
    const move=(event:PointerEvent)=>{pointerX.current=event.clientX;bypassSnap=event.altKey;};
    let unwatch=()=>{};
    const cleanup=()=>{unwatch();cancelAnimationFrame(frame);scrubRef.current=false;setScrubbing(false);target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',finish);target.removeEventListener('pointercancel',cancel);target.removeEventListener('lostpointercapture',cancel);gestureCleanup.current=null;if(target.hasPointerCapture(e.pointerId))target.releasePointerCapture(e.pointerId);};
    const finish=(event:PointerEvent)=>{pointerX.current=event.clientX;bypassSnap=event.altKey;update();cleanup();};
    const cancel=()=>{cleanup();onSeek(originalTime);paint(originalTime);};
    gestureCleanup.current=cancel;unwatch=watchCancellation(cancel);
    target.addEventListener('pointermove',move);target.addEventListener('pointerup',finish);target.addEventListener('pointercancel',cancel);target.addEventListener('lostpointercapture',cancel);tick();
  }
  function startLayerDrag(e:React.PointerEvent,group:LayerGroup,number:number){
    // Menu items render in a portal but their React events still bubble here.
    if(e.button!==0||!e.currentTarget.contains(e.target as Node)||(e.target as HTMLElement).closest('button'))return;
    e.preventDefault();gestureCleanup.current?.();lastTap.current=null;
    const source=`${group}-${number}`;setMovingLayer(source);let target=number;
    pointerX.current=e.clientX;pointerY.current=e.clientY;
    const viewport=scroll.current;if(!viewport){setMovingLayer(null);return;}
    const startScroll=viewport.scrollTop;const counts=deriveTrackCounts(timeline);
    const rows=Array.from(area.current?.querySelectorAll<HTMLElement>(`.timeline-track[data-group="${group}"]`)??[]).map(el=>{
      const rect=el.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,track:Number(el.dataset.layer)};
    });
    let unwatch=()=>{};
    const update=()=>{
      const hit=layerDropTarget(pointerY.current+viewport.scrollTop-startScroll,rows);
      const next=hit&&'edge' in hit?(hit.edge==='above'?counts[group]:1):hit?.track??number;
      if(next===target)return;target=next;setLayerDrop(target!==number?`${group}-${target}`:null);
    };
    const frame=timelineGestureFrame(update);
    const move=(event:PointerEvent)=>{if(event.pointerId!==e.pointerId)return;pointerX.current=event.clientX;pointerY.current=event.clientY;frame.request();};
    const cleanup=()=>{unwatch();frame.cancel();gestureUpdate.current=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);setMovingLayer(null);setLayerDrop(null);setInsertion(null);gestureCleanup.current=null;};
    const finish=(event:PointerEvent)=>{
      if(event.pointerId!==e.pointerId)return;
      const bounds=scroll.current?.parentElement?.getBoundingClientRect();
      const inside=!!bounds&&event.clientX>=bounds.left&&event.clientX<bounds.right&&event.clientY>=bounds.top&&event.clientY<bounds.bottom;
      if(inside){pointerX.current=event.clientX;pointerY.current=event.clientY;frame.flush();}cleanup();
      try{
        if(inside&&target!==number)onChange(reorderLayer(timeline,group,number,target));
      }catch(error){report(error);}
    };
    const cancel=()=>cleanup();gestureCleanup.current=cancel;unwatch=watchCancellation(cancel);gestureUpdate.current=frame.request;
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);
  }
  function startDrag(e:React.PointerEvent,clip:Clip,mode:'move'|'left'|'right'){
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();gestureCleanup.current?.();
    const current=store.getState().selectedIds;
    if(mode!=='move')lastTap.current=null;
    if(mode==='move'&&(e.shiftKey||e.ctrlKey||e.metaKey)){lastTap.current=null;const ids=current.includes(clip.id)?current.filter(id=>id!==clip.id):[...current,clip.id];store.setState({selectedIds:ids,selectedId:ids.at(-1)??null});return;}
    const members=current.includes(clip.id)?current:[clip.id];
    if(!current.includes(clip.id))onSelect(clip.id);
    const gestureMembers=linkedClipIds(timeline,members),gestureIds=new Set(gestureMembers);const selectedClips=timeline.clips.filter(c=>gestureIds.has(c.id));
    const viewport=scroll.current;const host=previews.current;if(!viewport||!host)return;
    const startX=e.clientX,startY=e.clientY,startScrollX=viewport.scrollLeft,startScrollY=viewport.scrollTop;
    const tapSlop=e.pointerType==='touch'?8:3;
    const group=layerGroup(clip.kind);
    // Hit-test against committed rows: a placement preview never changes its own drop targets.
    const rows=tracks.map(row=>{
      const node=area.current?.querySelector<HTMLElement>(`.timeline-track[data-group="${row.group}"][data-layer="${row.number}"]`);
      const rect=node?.getBoundingClientRect();return {track:row.number,group:row.group,top:rect?.top??0,bottom:rect?.bottom??0};
    });
    const trackMap=new Map(tracks.map(row=>[`${row.group}-${row.number}`,row]));
    const minimumTime=-Math.min(...selectedClips.map(c=>c.start)),maximumTime=300-Math.max(...selectedClips.map(c=>c.start+c.duration));
    let placedClips=new Map(timeline.clips.map(c=>[c.id,c])),targetTrackMap=trackMap,targetTrackKey='';
    const sourceRow=rows.find(row=>row.group===group&&row.track===trackOf(clip))!;
    const grabOffsetY=startY-sourceRow.top-3;
    const draggedHeight=tracks.find(row=>row.group===group&&row.number===trackOf(clip))!.clipHeight;
    const sourceNodes=new Map(Array.from(area.current?.querySelectorAll<HTMLElement>('.timeline-clip[data-clip-id]')??[]).map(node=>[node.dataset.clipId!,node]));
    const elements=new Map<string,{floating:HTMLElement;placement:HTMLElement}>();
    let clientX=startX,clientY=startY,next=clip,placed=timeline,moved=false,dropError:unknown=null,bypassSnap=e.altKey,lastInsertion='';
    let readout:HTMLDivElement|null=null,snapGuide:HTMLDivElement|null=null,dropHint:HTMLDivElement|null=null,insertionGuide:HTMLDivElement|null=null;
    activeMode.current=mode;pointerX.current=clientX;pointerY.current=clientY;
    const previousCursor=document.body.style.cursor;let unwatch=()=>{};
    const gestureCursor=mode==='move'?'default':'ew-resize';document.body.style.cursor=gestureCursor;
    const cursorStyle=document.createElement('style');cursorStyle.textContent=`.editor-app *{cursor:${gestureCursor}!important}`;document.head.appendChild(cursorStyle);
    const marks=[0,p.readPlaybackTime?.()??store.getState().playhead,...timeline.clips.filter(c=>!gestureIds.has(c.id)).flatMap(c=>[c.start,c.start+c.duration])];
    const verticalMarks=[...marks,clip.start,clip.start+clip.duration];
    const beginPreview=()=>{
      lastTap.current=null;setDrag(clip);host.replaceChildren();
      snapGuide=document.createElement('div');snapGuide.className='timeline-snap-guide';snapGuide.setAttribute('aria-hidden','true');snapGuide.style.display='none';host.appendChild(snapGuide);
      if(mode!=='move'){readout=document.createElement('div');readout.className='timeline-resize-readout';host.appendChild(readout);return;}
      insertionGuide=document.createElement('div');insertionGuide.className='timeline-insert-indicator';insertionGuide.style.display='none';const insertionLabel=document.createElement('span');insertionLabel.textContent=`New ${group==='audio'?'audio':'visual'} layer`;insertionGuide.appendChild(insertionLabel);host.appendChild(insertionGuide);
      dropHint=document.createElement('div');dropHint.className='timeline-drop-hint';dropHint.style.display='none';host.appendChild(dropHint);
      for(const member of selectedClips){
        const original=sourceNodes.get(member.id);if(!original)continue;
        const floating=original.cloneNode(true) as HTMLElement;
        floating.className=`timeline-clip timeline-floating-clip timeline-drag-preview clip-${member.kind==='video'||member.kind==='image'?'video':member.kind}`;
        floating.removeAttribute('role');floating.removeAttribute('tabindex');floating.removeAttribute('aria-pressed');floating.setAttribute('aria-hidden','true');floating.dataset.clipId=member.id;
        floating.querySelectorAll('.clip-trim').forEach(node=>node.remove());
        const originalCanvas=original.querySelector('canvas'),floatingCanvas=floating.querySelector('canvas');if(originalCanvas&&floatingCanvas)floatingCanvas.getContext('2d')?.drawImage(originalCanvas,0,0);
        floating.style.left='0';floating.style.top='0';floating.style.width=`${Math.max(6,member.duration*px)}px`;floating.style.height=`${layout.tracks.find(row=>row.group===layerGroup(member.kind)&&row.number===trackOf(member))!.clipHeight}px`;floating.style.opacity='';floating.style.visibility='visible';
        const placement=document.createElement('div');placement.className='timeline-destination-preview';placement.dataset.clipId=member.id;placement.setAttribute('aria-hidden','true');
        host.appendChild(placement);host.appendChild(floating);elements.set(member.id,{floating,placement});
      }
    };
    const showSnapGuide=(enabled:boolean,scrollTop:number,viewportHeight:number)=>{
      const candidates=mode==='move'?selectedClips.flatMap(c=>{const candidate=placedClips.get(c.id)!;return [candidate.start,candidate.start+candidate.duration];}):[next.start+(mode==='right'?next.duration:0)];
      const mark=enabled&&!dropError?marks.find(mark=>candidates.some(edge=>Math.abs(edge-mark)<1e-7)):undefined;
      if(snapGuide){
        snapGuide.style.display=mark===undefined?'none':'block';
        if(mark!==undefined){snapGuide.style.left=`${origin+mark*px}px`;snapGuide.style.top=`${scrollTop}px`;snapGuide.style.height=`${viewportHeight}px`;}
      }
      return mark!==undefined;
    };
    const update=()=>{
      if(!moved)return;
      // Read geometry before painting any preview nodes; avoid forced layout between writes.
      const geometry=viewport.getBoundingClientRect(),scrollLeft=viewport.scrollLeft,scrollTop=viewport.scrollTop,viewportHeight=viewport.clientHeight;
      const rawDelta=(clientX-startX+scrollLeft-startScrollX)/px;
      const magnet=snap&&!bypassSnap&&(mode!=='move'||Math.abs(rawDelta)>1e-6)?{marks:mode==='move'&&Math.abs(clientY-startY)>Math.abs(clientX-startX)?verticalMarks:marks,threshold:12/px}:undefined;
      if(mode==='move'){
        const scrollDelta=scrollTop-startScrollY;
        const target=clipLayerDropTarget(clientY+scrollDelta-grabOffsetY+draggedHeight/2,rows,group);
        const timeDelta=Math.max(minimumTime,Math.min(maximumTime,rawDelta));
        let insertionNext:typeof insertion=null;
        try{
          if(!target)throw new TimelineGestureRejection('Keep visual clips on V tracks and audio on A tracks.');
          placed=target&&'edge' in target?moveSelectionToNewLayers(timeline,members,timeDelta,target.edge,clip.id,magnet):moveSelectedClips(timeline,members,timeDelta,(target&&'track' in target?target.track:trackOf(clip))-trackOf(clip),target&&'direction' in target?target.direction:'above',clip.id,magnet);
          placedClips=new Map(placed.clips.map(c=>[c.id,c]));next=placedClips.get(clip.id)!;dropError=null;
          if(target&&'edge' in target)insertionNext={group,edge:target.edge};
          else if(deriveTrackCounts(placed)[group]>deriveTrackCounts(timeline)[group])insertionNext={group,edge:target&&'direction' in target?target.direction:'above',track:target&&'track' in target?target.track:trackOf(clip)};
        }catch(error){dropError=error;}
        const insertionKey=JSON.stringify(insertionNext);
        if(insertionKey!==lastInsertion){
          lastInsertion=insertionKey;
          if(insertionGuide){
            insertionGuide.style.display=insertionNext?'block':'none';
            const groupRows=tracks.filter(row=>row.group===group);
            const row=insertionNext?.track?groupRows.find(row=>row.number===insertionNext.track):insertionNext?.edge==='above'?groupRows[0]:groupRows.at(-1);
            if(row&&insertionNext)insertionGuide.style.top=`${row.top+(insertionNext.edge==='below'?row.height:0)}px`;
          }
        }
        if(insertionGuide?.firstElementChild)(insertionGuide.firstElementChild as HTMLElement).style.left=`${scrollLeft+12}px`;
        const invalid=String(!!dropError);if(host.dataset.invalid!==invalid)host.dataset.invalid=invalid;
        if(dropHint){
          dropHint.style.display=dropError?'block':'none';
          if(dropError){
            dropHint.textContent=!target?(group==='audio'?'A tracks only':'V tracks only'):dropError instanceof TimelineGestureRejection?dropError.message:'Cannot place here';
            dropHint.style.left=`${clientX-geometry.left+scrollLeft}px`;
            dropHint.style.top=`${clientY-geometry.top+scrollTop-26}px`;
          }
        }
        const magnetized=showSnapGuide(!!magnet,scrollTop,viewportHeight);
        const counts=deriveTrackCounts(placed),key=`${counts.visual}-${counts.audio}`;
        if(key!==targetTrackKey){targetTrackKey=key;targetTrackMap=new Map(timelineLayout(placed,dense).tracks.map(row=>[`${row.group}-${row.number}`,row]));}
        for(const member of selectedClips){
          const pair=elements.get(member.id);if(!pair)continue;
          const sourceRow=trackMap.get(`${layerGroup(member.kind)}-${trackOf(member)}`)!;
          const candidate=placedClips.get(member.id)!;
          // Lock to a magnetic join; otherwise keep the floating clip under the pointer.
          pair.floating.style.transform=`translate3d(${origin+(magnetized?candidate.start:member.start+rawDelta)*px}px,${sourceRow.top+3+(layerGroup(member.kind)===group?clientY-startY+scrollDelta:0)}px,0)`;
          const row=targetTrackMap.get(`${layerGroup(candidate.kind)}-${trackOf(candidate)}`)!;
          pair.placement.style.transform=`translate3d(${origin+candidate.start*px}px,${row.top+3}px,0)`;
          pair.placement.style.width=`${Math.max(6,candidate.duration*px)}px`;pair.placement.style.height=`${row.clipHeight}px`;
        }
      }else{
        placed=resizeSelectedClips(timeline,assets,[clip.id,...members.filter(id=>id!==clip.id)],mode,rawDelta,magnet);placedClips=new Map(placed.clips.map(c=>[c.id,c]));next=placedClips.get(clip.id)!;
        showSnapGuide(!!magnet,scrollTop,viewportHeight);
        for(const member of selectedClips){const node=sourceNodes.get(member.id),candidate=placedClips.get(member.id)!;if(node){node.style.left=`${origin+candidate.start*px}px`;node.style.width=`${Math.max(6,candidate.duration*px)}px`;if(candidate.kind==='audio')node.dispatchEvent(new CustomEvent('revline:clip-trim-preview',{detail:{sourceStart:candidate.sourceStart,duration:candidate.duration}}));}}
        if(readout){readout.textContent=`${next.duration.toFixed(2)}s`;readout.style.left=`${origin+(next.start+next.duration)*px}px`;readout.style.top=`${(tracks.find(row=>row.group===group&&row.number===trackOf(clip))?.top??RULER_HEIGHT)-18}px`;}
      }
    };
    const frame=timelineGestureFrame(update);
    const move=(event:PointerEvent)=>{
      if(event.pointerId!==e.pointerId)return;
      clientX=event.clientX;clientY=event.clientY;bypassSnap=event.altKey;pointerX.current=clientX;pointerY.current=clientY;
      if(!moved&&Math.hypot(clientX-startX,clientY-startY)>tapSlop){moved=true;beginPreview();}
      frame.request();
    };
    const cleanup=()=>{
      unwatch();gestureUpdate.current=null;document.body.style.cursor=previousCursor;cursorStyle.remove();frame.cancel();
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);
      if(mode!=='move')for(const member of selectedClips){const node=sourceNodes.get(member.id);if(node){node.style.left=`${origin+member.start*px}px`;node.style.width=`${Math.max(6,member.duration*px)}px`;if(member.kind==='audio')node.dispatchEvent(new CustomEvent('revline:clip-trim-preview',{detail:{sourceStart:member.sourceStart,duration:member.duration}}));}}
      host.replaceChildren();delete host.dataset.invalid;setDrag(null);setInsertion(null);gestureCleanup.current=null;
    };
    const finish=(event:PointerEvent)=>{
      if(event.pointerId!==e.pointerId)return;clientX=event.clientX;clientY=event.clientY;bypassSnap=event.altKey;
      const bounds=viewport.getBoundingClientRect();
      const commit=shouldCommitClipGesture(mode,{x:clientX,y:clientY},{left:bounds.left,top:bounds.top,width:viewport.clientWidth,height:viewport.clientHeight});
      if(commit)frame.flush();cleanup();
      if(!moved){
        if(mode==='move'&&commit&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&Math.hypot(clientX-startX,clientY-startY)<=tapSlop)finishClipTap(clip.id,event);
        else lastTap.current=null;
        return;
      }
      if(!commit)return;if(dropError){report(dropError);return;}
      if(placed.clips.some((candidate,index)=>{const original=timeline.clips[index];return candidate.start!==original.start||candidate.duration!==original.duration||candidate.sourceStart!==original.sourceStart||trackOf(candidate)!==trackOf(original);})||JSON.stringify(deriveTrackCounts(placed))!==JSON.stringify(deriveTrackCounts(timeline))){try{onChange(placed);}catch(error){report(error);}}
    };
    const cancel=()=>{lastTap.current=null;cleanup();};gestureCleanup.current=cancel;unwatch=watchCancellation(cancel);gestureUpdate.current=frame.request;
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);
  }

  function selectBox(e:React.PointerEvent<HTMLDivElement>){
    if(e.button!==0||(e.target as HTMLElement).closest('.timeline-clip,.playhead,.time-ruler'))return;
    e.preventDefault();gestureCleanup.current?.();lastTap.current=null;const el=area.current;if(!el)return;
    const rect=el.getBoundingClientRect();const start={x:e.clientX-rect.left,y:e.clientY-rect.top};
    const initial=e.shiftKey||e.ctrlKey||e.metaKey?store.getState().selectedIds:[];
    const previousSelection=store.getState().selectedIds;
    const rowMap=new Map(tracks.map(row=>[`${row.group}-${row.number}`,row]));
    const clipBounds=timeline.clips.map(clip=>{const row=rowMap.get(`${layerGroup(clip.kind)}-${trackOf(clip)}`)!;return {id:clip.id,left:origin+clip.start*px,top:row.top+3,width:clip.duration*px,height:row.clipHeight};});
    let unwatch=()=>{},active=false;
    pointerX.current=e.clientX;pointerY.current=e.clientY;
    const update=()=>{
      const r=el.getBoundingClientRect(),x=pointerX.current-r.left,y=pointerY.current-r.top;
      if(Math.abs(x-start.x)<5&&Math.abs(y-start.y)<5&&!active)return;
      if(!active){active=true;setSelecting(true);}
      const bounds={left:Math.min(start.x,x),top:Math.min(start.y,y),width:Math.abs(x-start.x),height:Math.abs(y-start.y)};
      const node=selectionBox.current;
      if(node){node.style.display='block';node.style.transform=`translate3d(${bounds.left}px,${bounds.top}px,0)`;node.style.width=`${bounds.width}px`;node.style.height=`${bounds.height}px`;}
      const hits=clipBounds.filter(clip=>intersectsSelection(bounds,clip)).map(clip=>clip.id);
      const ids=[...new Set([...initial,...hits])],current=store.getState().selectedIds;
      if(ids.length!==current.length||ids.some((id,index)=>id!==current[index]))store.setState({selectedIds:ids,selectedId:ids.at(-1)??null});
    };
    const frame=timelineGestureFrame(update);
    const move=(event:PointerEvent)=>{if(event.pointerId!==e.pointerId)return;pointerX.current=event.clientX;pointerY.current=event.clientY;frame.request();};
    const cleanup=()=>{unwatch();frame.cancel();gestureUpdate.current=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);if(selectionBox.current)selectionBox.current.style.display='none';setSelecting(false);gestureCleanup.current=null;};
    const finish=(event:PointerEvent)=>{if(event.pointerId!==e.pointerId)return;pointerX.current=event.clientX;pointerY.current=event.clientY;frame.flush();cleanup();if(!active){onSeek(frameSeekTime((start.x-origin)/px,timeline.fps,end));if(!initial.length)onSelect(null);}};
    const cancel=()=>{cleanup();store.setState({selectedIds:previousSelection,selectedId:previousSelection.at(-1)??null});};gestureCleanup.current=cancel;unwatch=watchCancellation(cancel);gestureUpdate.current=frame.request;
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);
  }

  function trimWithKeyboard(e:React.KeyboardEvent<HTMLButtonElement>,clip:Clip,side:'left'|'right'){
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
    if(e.metaKey||e.ctrlKey||e.altKey)return;
    e.preventDefault();e.stopPropagation();
    const current=store.getState().selectedIds;
    const members=current.includes(clip.id)?current:[clip.id];
    if(!current.includes(clip.id))onSelect(clip.id);
    const delta=(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?10:1)/timeline.fps;
    const next=resizeSelectedClips(timeline,assets,members,side,delta);
    if(next.clips.some((candidate,index)=>candidate.start!==timeline.clips[index].start||candidate.duration!==timeline.clips[index].duration))onChange(next);
  }

  function startVolume(e:React.PointerEvent<HTMLDivElement>,clip:Clip){
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();gestureCleanup.current?.();lastTap.current=null;
    const handle=e.currentTarget,rail=handle.parentElement!,node=rail.parentElement!;
    const initial=clip.volume??1,startY=e.clientY,height=rail.getBoundingClientRect().height;
    let volume=initial,pointerY=startY,unwatch=()=>{};
    onSelect(clip.id);handle.focus({preventScroll:true});handle.setPointerCapture(e.pointerId);rail.dataset.adjusting='true';
    const paint=(next:number)=>{
      rail.style.setProperty('--clip-volume',String(next));
      handle.setAttribute('aria-valuenow',String(Math.round(next*100)));handle.setAttribute('aria-valuetext',next===0?'Muted':`${Math.round(next*100)}%`);
      const readout=handle.querySelector('output');if(readout)readout.textContent=next===0?'Muted':`${Math.round(next*100)}%`;
      node.dispatchEvent(new CustomEvent('revline:clip-volume-preview',{detail:next}));
    };
    const frame=timelineGestureFrame(()=>{volume=clipVolumeAtPointer(initial,startY,pointerY,height);paint(volume);p.onPreviewVolume?.(clip.id,volume);});
    const move=(event:PointerEvent)=>{if(event.pointerId!==e.pointerId)return;pointerY=event.clientY;frame.request();};
    const cleanup=()=>{
      unwatch();frame.cancel();delete rail.dataset.adjusting;
      handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);handle.removeEventListener('lostpointercapture',cancel);
      gestureCleanup.current=null;if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);
    };
    const cancel=()=>{cleanup();paint(initial);p.onPreviewVolume?.(clip.id,null);};
    const finish=(event:PointerEvent)=>{
      if(event.pointerId!==e.pointerId)return;pointerY=event.clientY;frame.flush();cleanup();
      if(volume!==initial){try{onChange(patchClip(timeline,clip.id,{volume}));}catch(error){paint(initial);p.onPreviewVolume?.(clip.id,null);report(error);}}
      else p.onPreviewVolume?.(clip.id,null);
    };
    gestureCleanup.current=cancel;unwatch=watchCancellation(cancel);
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',cancel);handle.addEventListener('lostpointercapture',cancel);
  }
  function startTrackVolume(e:React.PointerEvent<HTMLInputElement>,clips:Clip[]){
    if(e.button!==0||!clips.length)return;e.preventDefault();e.stopPropagation();gestureCleanup.current?.();lastTap.current=null;
    const handle=e.currentTarget,rect=handle.getBoundingClientRect();
    const initial=Math.max(...clips.map(clip=>clip.volume??1));let volume=initial,pointerX=e.clientX,unwatch=()=>{};
    handle.focus({preventScroll:true});handle.setPointerCapture(e.pointerId);
    const nodes=new Map(Array.from(area.current?.querySelectorAll<HTMLElement>('.timeline-clip[data-clip-id]')??[]).map(node=>[node.dataset.clipId!,node]));
    const rails=new Map(clips.map(clip=>[clip.id,nodes.get(clip.id)?.querySelector<HTMLElement>('.audio-clip-volume')]));
    const paint=(next:number|null)=>{
      const value=next??initial;handle.value=String(Math.round(value*100));handle.style.setProperty('--track-volume',`${value/MAX_CLIP_VOLUME*100}%`);handle.setAttribute('aria-valuetext',`${Math.round(value*100)}%`);
      for(const clip of clips){
        const gain=next??clip.volume??1,node=nodes.get(clip.id);
        if(node){rails.get(clip.id)?.style.setProperty('--clip-volume',String(gain));node.dispatchEvent(new CustomEvent('revline:clip-volume-preview',{detail:gain}));}
        p.onPreviewVolume?.(clip.id,next);
      }
    };
    const frame=timelineGestureFrame(()=>{volume=clipVolumeAtFraction((pointerX-rect.left-6)/Math.max(1,rect.width-12));paint(volume);});
    const move=(event:PointerEvent)=>{if(event.pointerId!==e.pointerId)return;pointerX=event.clientX;frame.request();};
    const cleanup=()=>{
      unwatch();frame.cancel();handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);handle.removeEventListener('lostpointercapture',cancel);
      gestureCleanup.current=null;if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);
    };
    const cancel=()=>{cleanup();paint(null);};
    const finish=(event:PointerEvent)=>{
      if(event.pointerId!==e.pointerId)return;pointerX=event.clientX;frame.flush();cleanup();
      if(clips.some(clip=>(clip.volume??1)!==volume))onChange(clips.reduce((next,clip)=>patchClip(next,clip.id,{volume}),timeline));else paint(null);
    };
    gestureCleanup.current=cancel;unwatch=watchCancellation(cancel);
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',cancel);handle.addEventListener('lostpointercapture',cancel);frame.flush();
  }
  function volumeWithKeyboard(e:React.KeyboardEvent<HTMLDivElement>,clip:Clip){
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const step=e.shiftKey ? .1 : .01,current=clip.volume??1;
    const next=e.key==='Home'?0:e.key==='End'?MAX_CLIP_VOLUME:e.key==='ArrowUp'||e.key==='ArrowRight'?Math.min(MAX_CLIP_VOLUME,current+step):e.key==='ArrowDown'||e.key==='ArrowLeft'?Math.max(0,current-step):undefined;
    if(next===undefined)return;e.preventDefault();e.stopPropagation();
    gestureCleanup.current?.();onSelect(clip.id);const volume=Math.round(next*100)/100;
    if(volume!==current)onChange(patchClip(timeline,clip.id,{volume}));
  }
  function openContext(e:React.MouseEvent<HTMLElement>){
    const target=e.target as HTMLElement;
    if(!target.closest('.timeline-body')){e.preventDefault();return;}
    gestureCleanup.current?.();
    const clipId=target.closest<HTMLElement>('.timeline-clip')?.dataset.clipId,row=target.closest<HTMLElement>('.timeline-track,.track-label'),viewport=scroll.current;
    if(clipId){if(store.getState().selectedIds.includes(clipId))store.setState({selectedId:clipId});else onSelect(clipId);}
    const at=viewport?timelineTimeAtPointer(e.clientX,{left:viewport.getBoundingClientRect().left,scrollLeft:viewport.scrollLeft,origin,px,end,fps:timeline.fps}):time;
    setContext({clipId,group:row?.dataset.group as LayerGroup|undefined,track:row?.dataset.layer?Number(row.dataset.layer):undefined,time:at});
  }
  const contextClip=timeline.clips.find(clip=>clip.id===context?.clipId);
  const contextAudio=contextClip?.kind==='audio'?contextClip:timeline.clips.find(clip=>clip.id===contextClip?.linkedClipId);
  const contextClips=context?.group&&context.track?timeline.clips.filter(clip=>layerGroup(clip.kind)===context.group&&trackOf(clip)===context.track):[];
  const contextTime=context?.time??time;
  const runContext=(action:()=>void)=>{try{action();}catch(error){report(error);}};

  return <ContextMenu onOpenChange={open=>{if(!open)setContext(null);}}><ContextMenuTrigger asChild><section onContextMenu={openContext} className={`timeline-panel custom-timeline ${p.playbackControls?'timeline-with-playback':''} ${p.collapsed?'timeline-collapsed':''} ${dense?'tracks-compact':''}`} aria-label="Video timeline">
    <TimelinePlayheadClock playing={p.playing} readTime={p.readPlaybackTime} px={px} duration={end} origin={origin} viewport={scroll} head={head} cap={cap} scrubbing={scrubRef}/>
    <div className="timeline-toolbar"><div className="timeline-edit-actions">{!p.playbackControls&&<EditorPlaybackTime className="timeline-playback-time" time={time} duration={end} fps={timeline.fps} playing={p.playing} readTime={p.readPlaybackTime}/>}
      <button aria-label="Split selected clip" title="Split" onClick={p.onSplit} disabled={!selected}><Scissors size={14}/><span>Split</span></button>
      <button aria-label="Delete selected clips" title="Delete" onClick={p.onDelete} disabled={!selected}><Trash2 size={14}/><span>Delete</span></button>
      <button aria-label="Duplicate selected clips" title="Duplicate" onClick={p.onDuplicate} disabled={!selected}><Copy size={14}/><span>Duplicate</span></button>
      <button onClick={()=>p.onAddText('caption')} aria-label="Add caption" title="Add caption"><Type size={14}/><span>Caption</span></button>
      <button onClick={()=>p.onAddText('graphic')} aria-label="Add graphic" title="Add graphic"><Layers size={14}/><span>Graphic</span></button>
    </div>{p.playbackControls&&<div className="timeline-playback-controls">{p.playbackControls}</div>}<div className="timeline-view-actions">
      <IconButton label="Unlink video and audio" disabled={!timeline.clips.find(c=>c.id===selected)?.linkedClipId} onClick={()=>{if(selected)onChange(unlinkClips(timeline,selected));}}><Unlink size={14}/></IconButton>
      <IconButton label={p.muted?"Unmute preview":"Mute preview"} onClick={p.onToggleMute}>{p.muted?<VolumeX size={14}/>:<Volume2 size={14}/>}</IconButton>
      <IconButton label={dense?'Expand track rows':'Compact track rows'} onClick={()=>store.setState({compactTracks:!dense})}><Rows3 size={14}/></IconButton>
      <DropdownMenu><DropdownMenuTrigger aria-label="Add timeline layer"><Plus size={14}/><span>Layer</span></DropdownMenuTrigger><DropdownMenuContent>{([['visual','Visual layer'],['audio','Audio layer']] as const).map(([group,label])=><DropdownMenuItem key={group} onSelect={()=>addLayer(group)}>{label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
      <IconButton label="Remove empty tracks" disabled={cleanedTimeline===timeline} onClick={()=>onChange(cleanedTimeline)}><ListMinus size={14}/></IconButton>
      <button aria-label="Toggle snapping" onClick={()=>store.setState({snapping:!snap})} aria-pressed={snap} className={snap?'snap-active':''}><Magnet size={14}/></button>
      <IconButton label="Zoom out" onClick={()=>changeZoom(zoom/1.3)}><Minus size={14}/></IconButton><input aria-label="Timeline zoom" type="range" min=".15" max="4" step=".05" value={zoom} onChange={e=>changeZoom(Number(e.target.value))}/><IconButton label="Zoom in" onClick={()=>changeZoom(zoom*1.3)}><Plus size={14}/></IconButton>
      <IconButton label={p.collapsed?'Expand timeline':'Collapse timeline'} onClick={p.onToggleCollapse}>{p.collapsed?<ChevronUp size={14}/>:<ChevronDown size={14}/>}</IconButton>
    </div></div>
    <div className="timeline-body"><div className="track-headers" ref={labels} style={{marginBottom:scrollbarHeight}} onScroll={e=>{const viewport=scroll.current;if(viewport&&viewport.scrollTop!==e.currentTarget.scrollTop)viewport.scrollTop=e.currentTarget.scrollTop;}}><div className="track-ruler-label"/><div className="timeline-top-space" aria-hidden="true" style={{height:TIMELINE_TOP_SPACE}}/>{tracks.map(track=>{
      const clips=timeline.clips.filter(c=>layerGroup(c.kind)===track.group&&trackOf(c)===track.number);
      const audible=clips.filter(c=>c.kind==='audio'||c.kind==='video'&&(!c.audioSeparated||!!c.linkedClipId));
      const muted=audible.length>0&&audible.every(c=>(c.linkedClipId&&c.kind==='video'?timeline.clips.find(a=>a.id===c.linkedClipId)?.volume:c.volume)===0);
      return <div key={track.id} data-layer={track.number} data-track-id={track.id} onPointerDown={e=>startLayerDrag(e,track.group,track.number)} className={`track-label ${layerDrop===track.id?'layer-drop-target':''} ${movingLayer===track.id?'layer-moving':''}`} data-group={track.group} style={{height:track.height}} title={`Drag to reorder ${track.label}`}>
        <span className="track-label-name"><span className="track-dot" style={{background:track.color}}/>{track.label}</span><span className="track-label-kind">{track.group==='audio'?'Audio':'Visual'}</span>
        <DropdownMenu><DropdownMenuTrigger className="layer-options" aria-label={`Options for ${track.label}`}><MoreHorizontal size={12}/></DropdownMenuTrigger><DropdownMenuContent>
          <DropdownMenuItem disabled={track.number>=maxTrackCount(track.group)} onSelect={()=>onChange(reorderLayer(timeline,track.group,track.number,track.number+1))}>Move layer up</DropdownMenuItem>
          <DropdownMenuItem disabled={track.number<=1} onSelect={()=>onChange(reorderLayer(timeline,track.group,track.number,track.number-1))}>Move layer down</DropdownMenuItem>
          <DropdownMenuItem disabled={clips.length>0} onSelect={()=>onChange(deleteEmptyLayer(timeline,track.group,track.number))}>Delete empty layer</DropdownMenuItem>
          <DropdownMenuItem disabled={!audible.length} onSelect={()=>toggleTrackSound(audible)}>Toggle sound</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
        {track.group==='audio'&&<div className="track-audio-controls" onPointerDown={e=>e.stopPropagation()}>
          <button type="button" className="track-audio-toggle" aria-label={`${muted?'Unmute':'Mute'} ${track.label}`} title={`${muted?'Unmute':'Mute'} audio track`} aria-pressed={muted} disabled={!audible.length} onClick={()=>toggleTrackSound(audible)}>{muted?<VolumeX size={14}/>:<Volume2 size={14}/>}</button>
          <input type="range" min="0" max={MAX_CLIP_VOLUME*100} step="1" value={Math.round(Math.max(0,...audible.map(clip=>clip.volume??1))*100)} aria-label={`Volume for ${track.label}`} aria-valuetext={`${Math.round(Math.max(0,...audible.map(clip=>clip.volume??1))*100)}%`} disabled={!audible.length} style={{'--track-volume':`${Math.max(0,...audible.map(clip=>clip.volume??1))/MAX_CLIP_VOLUME*100}%`} as React.CSSProperties} onPointerDown={e=>startTrackVolume(e,audible)} onChange={e=>{if(!gestureCleanup.current)onChange(audible.reduce((next,clip)=>patchClip(next,clip.id,{volume:Number(e.target.value)/100}),timeline));}}/>
        </div>}
      </div>;
    })}<div aria-hidden="true" style={{height:Math.max(TIMELINE_BOTTOM_SPACE,viewportHeight-layout.height)}}/></div>
      <div className="timeline-scroll" ref={scroll} onScroll={e=>{if(labels.current)labels.current.scrollTop=e.currentTarget.scrollTop;gestureUpdate.current?.();}}>
        <div ref={area} className="timeline-track-area" style={{width:width+origin*2,height:Math.max(layout.height+TIMELINE_BOTTOM_SPACE,viewportHeight)}} onPointerDown={selectBox}><div className="time-ruler" style={{'--ruler-unit':`${px}px`} as React.CSSProperties} onPointerDown={startScrub}><TimelineRulerTicks px={px} duration={duration} fps={timeline.fps} origin={origin}/></div>
          <div className="timeline-top-space" aria-hidden="true" style={{height:TIMELINE_TOP_SPACE}}/>
          {tracks.map(track=><div key={track.id} data-group={track.group} data-layer={track.number} className="timeline-track" style={{height:track.height}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('revline/asset');const asset=assetMap.get(id);if(!asset)return;if(layerGroup(asset.kind)!==track.group){report(new Error('Drop video or images on a visual layer, and audio on an audio layer.'));return;}try{onChange(addMediaClip(timeline,asset,crypto.randomUUID(),Math.max(0,snapTime((e.clientX-e.currentTarget.getBoundingClientRect().left-origin)/px,timeline.fps)),track.number));}catch(error){report(error);}}}>
            {timeline.clips.filter(c=>layerGroup(c.kind)===track.group&&trackOf(c)===track.number).map(clip=>{
              const position=clip;const asset=assetMap.get(clip.assetId??'');const isMedia=clip.kind==='video'||clip.kind==='image';
              return <div key={clip.id} data-clip-id={clip.id} role="button" tabIndex={0} aria-label={`${clip.text||asset?.fileName||clip.kind}, ${track.label}, ${formatTime(clip.start)}, ${clip.duration.toFixed(1)} seconds`} aria-pressed={linkedSelection.has(clip.id)} onDragStart={e=>e.preventDefault()} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='Enter'||e.code==='Space'){e.preventDefault();e.stopPropagation();onSelect(clip.id);if(e.key==='Enter'&&(clip.kind==='caption'||clip.kind==='graphic'))p.onEditText?.(clip.id);} }} onPointerDown={e=>startDrag(e,clip,'move')} className={`timeline-clip ${(linkedSelection.has(clip.id))?'selected':''} clip-${isMedia?'video':clip.kind}`} style={{'--clip-height':`${track.clipHeight}px`,height:track.clipHeight,left:origin+position.start*px,width:Math.max(6,position.duration*px),background:clipColor(clip.kind),...(drag&&activeMode.current==='move'&&(linkedSelection.has(clip.id)||drag.id===clip.id)?{visibility:'hidden'}: {})} as React.CSSProperties}>
                {asset?.url&&isMedia&&<MediaFilmstrip asset={asset} width={Math.max(6,position.duration*px)} height={track.clipHeight} sourceStart={clip.sourceStart} duration={clip.duration} timelineStart={clip.start} px={px} fps={timeline.fps} viewport={scroll} paused={!!drag||scrubbing||!!movingLayer}/>} {clip.kind==='audio'&&<AudioWaveform waveform={asset?.waveform} sourceStart={clip.sourceStart} duration={clip.duration} volume={clip.volume} timelineStart={clip.start} viewport={scroll}/>}<span>{clip.text||asset?.fileName||'Clip'}</span>
                {clip.kind==='audio'&&<div className="audio-clip-volume" style={{'--clip-volume':clip.volume??1} as React.CSSProperties}><div className="audio-volume-line" role="slider" tabIndex={0} aria-label={`Volume for ${asset?.fileName||'audio clip'}`} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={MAX_CLIP_VOLUME*100} aria-valuenow={Math.round((clip.volume??1)*100)} aria-valuetext={clip.volume===0?'Muted':`${Math.round((clip.volume??1)*100)}%`} onPointerDown={e=>startVolume(e,clip)} onKeyDown={e=>volumeWithKeyboard(e,clip)}><output aria-hidden="true">{clip.volume===0?'Muted':`${Math.round((clip.volume??1)*100)}%`}</output></div></div>}
                <button className="clip-trim left" aria-label="Trim clip start" title="Drag or use arrow keys to trim; Shift moves ten frames" onKeyDown={e=>trimWithKeyboard(e,clip,'left')} onPointerDown={e=>startDrag(e,clip,'left')}/><button className="clip-trim right" aria-label="Trim clip end" title="Drag or use arrow keys to trim; Shift moves ten frames" onKeyDown={e=>trimWithKeyboard(e,clip,'right')} onPointerDown={e=>startDrag(e,clip,'right')}/>
              </div>;
            })}
          </div>)}
          {insertion&&(()=>{
            const groupRows=tracks.map((track,index)=>({...track,index})).filter(track=>track.group===insertion.group);
            const row=insertion.track?groupRows.find(track=>track.number===insertion.track):insertion.edge==='above'?groupRows[0]:groupRows.at(-1);
            if(!row)return null;const top=row.top+(insertion.edge==='below'?row.height:0);
            return <div className="timeline-insert-indicator" style={{top}} aria-label={`Create ${insertion.group} layer ${insertion.edge}`}><span style={{left:(scroll.current?.scrollLeft??0)+12}}>New {insertion.group==='audio'?'audio':'visual'} layer</span></div>;
          })()}
          <div ref={selectionBox} className="timeline-selection-box" style={{display:'none',left:0,top:0}} aria-hidden="true"/>
          <div ref={previews} className="timeline-drag-previews" aria-hidden="true"/>
          {!timeline.clips.length&&<div className="timeline-empty">Your clips will land here.</div>}
          <div ref={head} className="playhead" style={{left:0,height:"100%"}} onPointerDown={startScrub} aria-label="Timeline playhead"/>
        </div>
      </div>
      <div ref={cap} className="timeline-playhead-cap" onPointerDown={startScrub} aria-label="Drag timeline playhead"/>
    </div>
  </section></ContextMenuTrigger><ContextMenuContent aria-label="Timeline actions">
    <ContextMenuLabel>{contextClip?'Clip':context?.track?`${context.group==='audio'?'A':'V'}${context.track}`:'Timeline'}</ContextMenuLabel>
    {contextClip&&p.onCopy&&<ContextMenuItem onSelect={p.onCopy}><Copy/>Copy</ContextMenuItem>}
    {p.onPaste&&<ContextMenuItem disabled={!p.canPaste} onSelect={()=>p.onPaste?.(contextTime)}><ClipboardPaste/>Paste here</ContextMenuItem>}
    {contextClip?<>
      {(contextClip.kind==='caption'||contextClip.kind==='graphic')&&<ContextMenuItem onSelect={()=>p.onEditText?.(contextClip.id)}><Type/>Edit text</ContextMenuItem>}
      <ContextMenuItem disabled={contextTime<contextClip.start+1/timeline.fps||contextTime>contextClip.start+contextClip.duration-1/timeline.fps} onSelect={()=>runContext(()=>{onSeek(contextTime);onChange(splitClip(timeline,contextClip.id,contextTime,crypto.randomUUID()));})}><Scissors/>Split here</ContextMenuItem>
      <ContextMenuItem onSelect={p.onDuplicate}><Copy/>Duplicate</ContextMenuItem>
      <ContextMenuItem onSelect={p.onDelete}><Trash2/>Delete</ContextMenuItem>
      {contextClip.linkedClipId&&<ContextMenuItem onSelect={()=>onChange(unlinkClips(timeline,contextClip.id))}><Unlink/>Unlink video and audio</ContextMenuItem>}
      {(contextClip.kind==='audio'||contextClip.kind==='video'&&!contextClip.audioSeparated)&&<ContextMenuItem onSelect={()=>toggleTrackSound([contextClip])}>{(contextAudio??contextClip).volume===0?<VolumeX/>:<Volume2/>}{(contextAudio??contextClip).volume===0?'Unmute clip':'Mute clip'}</ContextMenuItem>}
      <ContextMenuSeparator/>
    </>:<>
      {context?.group!=='audio'&&<><ContextMenuItem onSelect={()=>runContext(()=>onChange(addTextClip(timeline,crypto.randomUUID(),'caption',contextTime)))}><Type/>Add caption here</ContextMenuItem><ContextMenuItem onSelect={()=>runContext(()=>onChange(addTextClip(timeline,crypto.randomUUID(),'graphic',contextTime)))}><Layers/>Add graphic here</ContextMenuItem><ContextMenuSeparator/></>}
      {context?.group&&context.track&&<><ContextMenuItem disabled={context.track>=deriveTrackCounts(timeline)[context.group]} onSelect={()=>runContext(()=>onChange(reorderLayer(timeline,context.group!,context.track!,context.track!+1)))}><ChevronUp/>Move track up</ContextMenuItem><ContextMenuItem disabled={context.track<=1} onSelect={()=>runContext(()=>onChange(reorderLayer(timeline,context.group!,context.track!,context.track!-1)))}><ChevronDown/>Move track down</ContextMenuItem><ContextMenuItem disabled={contextClips.length>0} onSelect={()=>runContext(()=>onChange(deleteEmptyLayer(timeline,context.group!,context.track!)))}><Trash2/>Delete empty track</ContextMenuItem><ContextMenuSeparator/></>}
    </>}
    <ContextMenuItem disabled={deriveTrackCounts(timeline).visual>=maxTrackCount('visual')} onSelect={()=>addLayer('visual')}><Plus/>Add visual track</ContextMenuItem>
    <ContextMenuItem disabled={deriveTrackCounts(timeline).audio>=maxTrackCount('audio')} onSelect={()=>addLayer('audio')}><Plus/>Add audio track</ContextMenuItem>
    <ContextMenuItem disabled={cleanedTimeline===timeline} onSelect={()=>onChange(cleanedTimeline)}><ListMinus/>Remove empty tracks</ContextMenuItem>
  </ContextMenuContent></ContextMenu>;
}
