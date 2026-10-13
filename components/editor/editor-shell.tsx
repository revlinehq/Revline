'use client';
import { splitAtPlayhead } from '@/lib/editor/split-at-playhead';
import { addTimelineMarker } from '@/lib/editor/timeline-markers';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Upload, MessageSquare, Film, LoaderCircle, RotateCcw } from 'lucide-react';
import { useEditorStore, useEditorState } from './editor-state';
import { usePanelRef } from 'react-resizable-panels';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Sheet,SheetContent,SheetTitle,SheetDescription } from '@/components/ui/sheet';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import { ProjectImportStage } from './project-entry';
import { Preview, type PreviewHandle } from './preview';
import { PreviewZoomControls, PreviewZoomProvider, PreviewViewport } from './preview-zoom';
import { CanvasSettings } from './canvas-settings';
import { AspectRatioControl } from './aspect-ratio-control';
import { MediaImportDialog } from './media-import-dialog';
import { PreviewInspector } from './preview-inspector';
import { EditorPlaybackControls } from './playback-controls';
import { TimelinePanel } from './timeline';
import type { VideoImportState } from './video-link-import';
import { FootagePanel, type UploadProgress } from './footage-panel';
import { AssistantPanel, type ChatMessage } from './assistant-panel';
import type { AssistantEditSnapshot } from './assistant-results';
import { ExportDialog, type ExportSettings, type ExportState } from './export-dialog';
import { EditorErrorNotice } from './error-notice';
import { type Timeline, type MediaAsset, type AspectRatio, type Clip, timelineDuration, dimensions } from '@/lib/editor/types';
import { addMediaClip, addTextClip, addEffectClip, setClipPlaybackRate, patchClip, frameSeekTime, linkedClipIds } from '@/lib/editor/operations';
import type { EffectPreset } from '@/lib/editor/clip-effects';
import { addFadeThroughBlack, addOverlayClip } from '@/lib/editor/library-actions';
import type { RemotionTextPreset } from '@/lib/editor/remotion-text';
import { textTemplatePatch } from '@/lib/editor/text-effects';
import { subtitleStylePatch, type SubtitleStyleId } from '@/lib/editor/subtitle-styles';
import { copyTimelineClips, pasteTimelineClips } from '@/lib/editor/clipboard';
import type { RefreshPlaybackMedia } from '@/lib/editor/media-source-recovery';
import { MediaFileDropOverlay, useMediaFileDrop } from './media-file-drop';

const NO_SELECTED_CLIPS:string[]=[];
export type EditContext = { selectedClipId?: string; selectedClipIds?:string[]; playhead: number };
export type EditorShellProps = {
  title: string; timeline: Timeline; assets: MediaAsset[]; onChange: (t: Timeline) => void;
  onTitle: (title: string) => void; onUpload: (files: File[]) => Promise<void>;
  onDropUpload: (files: File[]) => Promise<void>;
  saving: boolean; upload: UploadProgress; error: string; onError: (message: string) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  messages: ChatMessage[]; aiRunning: boolean; aiConfigured: boolean; aiError?: string | null; draftKey?:string;
  onSend: (text: string, context?: EditContext) => Promise<void>;
  onStop?: () => Promise<void>;
  assistantEditSnapshot?:AssistantEditSnapshot;onAssistantUndo?:()=>void|Promise<void>;
  onExport: (settings: ExportSettings) => Promise<void>; exportState: ExportState; demo?: boolean; embedded?: boolean;
  analysisBusy?: string | null; onLoadMore?: () => void; canLoadMore?: boolean;
  projectId?: string; workspaceOnly?: boolean; onImportVideo?: (url:string)=>Promise<void>; videoImports?: VideoImportState[];
  onRefreshMedia?:RefreshPlaybackMedia;
};

export function EditorShell(p: EditorShellProps) {
  const { timeline, assets, onChange, onError } = p;
  const dismissError = useCallback(() => onError(''), [onError]);
  const params = useSearchParams();
  const [compact,setCompact]=useState(false);useEffect(()=>{const media=matchMedia('(max-width:900px)');const update=()=>setCompact(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const [importOpen,setImportOpen]=useState(false);
  const [footageOpen, setFootageOpen] = useState(params.get('panel') === 'footage');
  const store=useEditorStore();const selected=useEditorState(s=>s.selectedId);const selectedIds=useEditorState(s=>s.selectedIds??NO_SELECTED_CLIPS);const setSelected=(id:string|null)=>store.setState({selectedId:id,selectedIds:id?[id]:[]});
  const [clipboard, setClipboard] = useState<Clip[]>([]);
  useEffect(() => { setClipboard([]); }, [p.projectId]);
  const [croppingClip, setCroppingClip] = useState<string | null>(null);
  // Clock-dependent leaves subscribe to position; the workspace itself does
  // not rebuild for playback ticks or pointer scrubbing.
  const time=store.getState().playhead;const setTime=useCallback((playhead:number)=>store.setState({playhead}),[store]);
  const playing=useEditorState(s=>s.playing);const setPlaying=useCallback((playing:boolean)=>store.setState({playing}),[store]);
  const muted=useEditorState(s=>s.muted);const setMuted=(muted:boolean)=>store.setState({muted});
  const [exportOpen, setExportOpen] = useState(params.get('export') === '1');
  const [mobileChat, setMobileChat] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(!p.embedded);
  const inspectorRequest = useRef(0);
  const [sourceRequest, setSourceRequest] = useState(0);
  const [editRequest, setEditRequest] = useState(0);
  const fileDrop = useMediaFileDrop({ busy: !!p.upload, onUpload: files => { setSourceRequest(++inspectorRequest.current); setInspectorOpen(true); return p.onDropUpload(files); }, onError });
  useEffect(() => { if (compact) setInspectorOpen(false); }, [compact]);
  const editorRoot = useRef<HTMLElement>(null);
  const timelinePanel=usePanelRef();const collapsed=useEditorState(s=>s.timelineCollapsed);const toggleTimeline=()=>{if(collapsed)timelinePanel.current?.expand();else timelinePanel.current?.collapse();store.setState({timelineCollapsed:!collapsed});};
  const workspace = useRef({ projectId: p.projectId, opened: false });
  if (workspace.current.projectId !== p.projectId) workspace.current = { projectId: p.projectId, opened: false };
  if (!p.upload && (timeline.clips.length || assets.length || p.canUndo || p.aiRunning)) workspace.current.opened = true;
  // Empty edits are still projects: keep the conversation, stop button and timeline mounted.
  const preparing = !workspace.current.opened && !p.aiRunning;
  const previousTimeline = useRef(timeline);
  const preview = useRef<PreviewHandle>(null);
  const readPlaybackTime=useCallback(()=>preview.current?.currentTime()??store.getState().playhead,[store]);
  const duration = timelineDuration(timeline);
  const clip = timeline.clips.find(c => c.id === selected);
  const suggestionAsset = clip?.kind === 'video'
    ? assets.find(asset => asset._id === clip.assetId)
    : assets.find(asset => asset.kind === 'video' && asset.analysis?.understanding?.suggestions?.length && timeline.clips.some(item => item.kind === 'video' && item.assetId === asset._id));
  const suggestionClip = suggestionAsset ? (clip?.kind === 'video' && clip.assetId === suggestionAsset._id ? clip : timeline.clips.find(item => item.kind === 'video' && item.assetId === suggestionAsset._id)) : undefined;
  const sourceSuggestions = suggestionAsset && suggestionClip && suggestionAsset.analysis?.understanding?.suggestions?.length ? { sourceName: suggestionAsset.fileName, clipId: suggestionClip.id, items: suggestionAsset.analysis.understanding.suggestions } : undefined;
  const cropping = !!clip && clip.id === croppingClip;
  useEffect(() => { if (croppingClip && (!clip || clip.id !== croppingClip)) setCroppingClip(null); }, [clip?.id, croppingClip]);
  const seek = useCallback((n: number) => {
    const t = frameSeekTime(n, timeline.fps, duration);
    setCroppingClip(null); setTime(t); preview.current?.seek(t);
  }, [duration, timeline.fps, setTime]);
  const changeAspectRatio = (aspectRatio: AspectRatio) => {
    preview.current?.pause();
    setCroppingClip(null);
    onChange({ ...timeline, aspectRatio });
  };

  useEffect(() => {
    if (p.aiRunning && previousTimeline.current !== timeline) {
      const changed = timeline.clips.find(c => JSON.stringify(c) !== JSON.stringify(previousTimeline.current.clips.find(old => old.id === c.id)));
      if (changed) { setSelected(changed.id); seek(changed.start); }
    }
    previousTimeline.current = timeline;
  }, [timeline, p.aiRunning, seek]);

  const togglePlay = useCallback(() => {
    if (cropping) return;
    if (playing) preview.current?.pause();
    else { if (readPlaybackTime() >= duration) seek(0); preview.current?.play(); }
  }, [cropping, playing, readPlaybackTime, duration, seek]);
  const jumpCut = (direction: -1 | 1) => {
    preview.current?.pause();
    const current = readPlaybackTime();
    const cuts = [...new Set([0, duration, ...timeline.clips.filter(c => c.kind === 'video' || c.kind === 'image').flatMap(c => [c.start, c.start + c.duration])])].sort((a, b) => a - b);
    seek(direction < 0 ? cuts.filter(t => t < current - 1 / timeline.fps).at(-1) ?? 0 : cuts.find(t => t > current + 1 / timeline.fps) ?? duration);
  };
  const doSplit = useCallback(() => {
    const current = store.getState();
    const at = current.playing ? readPlaybackTime() : current.playhead;
    try { onChange(splitAtPlayhead(timeline, current.selectedIds.length ? current.selectedIds : current.selectedId ? [current.selectedId] : [], at)); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not split this clip.'); }
  }, [onChange, onError, timeline, readPlaybackTime, store]);
  const doDelete = useCallback(() => {
    const ids=new Set(linkedClipIds(timeline,selectedIds.length?selectedIds:selected?[selected]:[]));
    if(!ids.size)return;onChange({...timeline,clips:timeline.clips.filter(c=>!ids.has(c.id))});setSelected(null);setCroppingClip(null);
  }, [selected, selectedIds, timeline, onChange]);
  const addMarker = useCallback(() => {
    const current = store.getState();
    const next = addTimelineMarker(timeline, current.playing ? readPlaybackTime() : current.playhead, crypto.randomUUID());
    if (next !== timeline) onChange(next);
  }, [timeline, onChange, readPlaybackTime, store]);
  const doCopy = useCallback(() => {
    const clips = copyTimelineClips(timeline, selectedIds.length ? selectedIds : selected ? [selected] : []);
    if (clips.length) setClipboard(clips);
  }, [timeline, selectedIds, selected]);
  const pasteCopies = useCallback((clips: Clip[], at: number) => {
    try {
      const pasted = pasteTimelineClips(timeline, clips, at);
      if (!pasted.ids.length) return;
      onChange(pasted.timeline);
      store.setState({ selectedId: pasted.ids[0], selectedIds: pasted.ids });
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not paste these clips.'); }
  }, [timeline, onChange, onError, store]);
  const doPaste = useCallback((at?: number) => pasteCopies(clipboard, at ?? readPlaybackTime()), [clipboard, pasteCopies, readPlaybackTime]);
  const doDuplicate = () => {
    const originals = copyTimelineClips(timeline, selectedIds.length ? selectedIds : selected ? [selected] : []);
    if (originals.length) pasteCopies(originals, Math.max(...originals.map(clip => clip.start + clip.duration)));
  };

  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (p.embedded && !editorRoot.current?.contains(target)) return;
      if (target.closest('input,textarea,select,[role="slider"],[role="menu"],[contenteditable="true"]')) return;
      if (cropping) { if (e.key === 'Escape') setCroppingClip(null); if (e.code === 'Space' && !target.closest('button,a,[role="button"]')) e.preventDefault(); return; }
      const dialog = target.closest('[role="dialog"]');
      if (dialog && dialog !== editorRoot.current?.closest('[role="dialog"]')) return;
      // Let focused controls keep their native Space activation. Clips handle
      // Space locally, so selecting one never toggles preview playback.
      if (e.code === 'Space' && target.closest('button,a,[role="button"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="switch"]')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); if (!e.repeat) doSplit(); }
      else if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); if (!e.repeat) addMarker(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); doDelete(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); store.setState({selectedIds:timeline.clips.map(c=>c.id),selectedId:selected??timeline.clips[0]?.id??null}); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && (selectedIds.length || selected)) { e.preventDefault(); doCopy(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && clipboard.length) { e.preventDefault(); doPaste(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) p.onRedo(); else p.onUndo(); }
      else if (e.key === 'Escape') { setSelected(null); setMobileChat(false); }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [doSplit, doDelete, doCopy, doPaste, addMarker, clipboard.length, selectedIds.length, togglePlay, p.onUndo, p.onRedo, timeline.clips, selected, store, cropping]);

  function addAsset(asset: MediaAsset) {
    try { const id = crypto.randomUUID(); onChange(addMediaClip(timeline, asset, id)); setSelected(id); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not add this source.'); }
  }
  function addEffect(preset: EffectPreset) {
    try {
      const id = crypto.randomUUID();
      onChange(addEffectClip(timeline, id, preset, preview.current?.currentTime() ?? time, { aboveClipId: clip?.id }));
      setSelected(id);
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not add this effect.'); }
  }
  function addLibraryText(preset: RemotionTextPreset) { addText('graphic', { preset }); }
  function addSubtitleStyle(style: SubtitleStyleId) { addText('caption', { style }); }
  function addOverlay(asset: MediaAsset) {
    try {
      const id = crypto.randomUUID();
      onChange(addOverlayClip(timeline, asset, id, readPlaybackTime()));
      setSelected(id);
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not add this overlay.'); }
  }
  function fadeThroughBlack() {
    if (!clip) return;
    try {
      const id = crypto.randomUUID();
      onChange(addFadeThroughBlack(timeline, clip.id, id));
      setSelected(id);
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not add this transition.'); }
  }
  function changeSpeed(rate: number) {
    if (!clip) return;
    try { onChange(setClipPlaybackRate(timeline, clip.id, rate)); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not change playback speed.'); }
  }
  function openTextSettings(id: string) {
    setSelected(id); setInspectorOpen(true); setEditRequest(++inspectorRequest.current);
  }
  function editText(id: string) {
    const item = timeline.clips.find(c => c.id === id);
    if (item?.kind === 'caption' || item?.kind === 'graphic') openTextSettings(id);
  }
  function selectClip(id:string|null){
    if (id !== selected) setCroppingClip(null);
    const item = timeline.clips.find(c => c.id === id);
    if (item?.kind === 'caption' || item?.kind === 'graphic') openTextSettings(item.id);
    else setSelected(id);
  }
  function cropVisual() {
    if (cropping) { preview.current?.finishCrop(); return; }
    const asset = assets.find(item => item._id === clip?.assetId);
    if (!clip || (clip.kind !== 'video' && clip.kind !== 'image') || !asset?.width || !asset?.height || !asset.url) return;
    preview.current?.pause();
    const current = readPlaybackTime();
    if (current < clip.start || current >= clip.start + clip.duration) seek(Math.ceil((clip.start - 1e-7) * timeline.fps) / timeline.fps);
    setCroppingClip(clip.id);
    if (compact) setInspectorOpen(false);
  }
  function addText(kind: 'caption' | 'graphic', options: { preset?: RemotionTextPreset; style?: SubtitleStyleId } = {}) {
    try {
      const id = crypto.randomUUID();
      let next = addTextClip(timeline, id, kind, readPlaybackTime());
      if (options.preset) next = patchClip(next, id, textTemplatePatch(next.clips.find(item => item.id === id)!, options.preset));
      if (options.style) next = patchClip(next, id, subtitleStylePatch(options.style));
      onChange(next); openTextSettings(id);
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not add this text.'); }
  }
  const browse = () => setImportOpen(true);

  const chat=(<aside className={`editor-sidebar ${mobileChat ? 'mobile-open' : ''}`} aria-label="Editing conversation">
        <AssistantPanel editSnapshot={p.assistantEditSnapshot} onUndo={p.onAssistantUndo} messages={p.messages} running={p.aiRunning} configured={p.aiConfigured} error={p.aiError} onSend={text => p.onSend(text, { selectedClipId: clip?.id, selectedClipIds:selectedIds, playhead: readPlaybackTime() })} onStop={p.onStop} hasClips={!!timeline.clips.length} demo={!!p.demo} onLoadMore={p.onLoadMore} canLoadMore={p.canLoadMore} onAttach={() => setImportOpen(true)} activity={p.analysisBusy} draftKey={p.draftKey} suggestions={sourceSuggestions} onSuggestion={async (text, clipId) => { const target = timeline.clips.find(item => item.id === clipId && item.kind === 'video'); if (!target) throw new Error('This clip is no longer on the timeline.'); setSelected(clipId); await p.onSend(text, { selectedClipId: clipId, selectedClipIds: [clipId], playhead: target.start }); }} />
      </aside>);
  return <main ref={editorRoot} tabIndex={-1} {...fileDrop.handlers} onPointerDownCapture={e => { const interactive = (e.target as HTMLElement).closest('input,textarea,button,a,select,[tabindex]'); if (p.embedded) { if (!interactive || interactive === e.currentTarget || !e.currentTarget.contains(interactive)) editorRoot.current?.focus({ preventScroll: true }); else if (interactive.matches('[tabindex]') && !interactive.matches('input,textarea,button,a,select')) (interactive as HTMLElement).focus({ preventScroll: true }); } }} className={`editor-app conversation-editor ${p.embedded ? 'embedded-editor' : ''}`}>
    <MediaFileDropOverlay active={fileDrop.active} busy={!!p.upload}/>
    {!p.workspaceOnly && <WorkspaceNav title={p.title} onRename={p.onTitle} onFootage={() => setFootageOpen(true)} onExport={() => setExportOpen(true)} exportDisabled={!timeline.clips.length} onUndo={p.onUndo} onRedo={p.onRedo} canUndo={p.canUndo} canRedo={p.canRedo} saving={p.saving} demo={p.demo}/>}

    <EditorErrorNotice message={p.error} onDismiss={dismissError} />
    {!preparing&&<>{!p.workspaceOnly && <div className="mobile-panel-controls"><button aria-expanded={mobileChat} onClick={() => setMobileChat(!mobileChat)}><MessageSquare size={14} />{mobileChat ? 'Back to preview' : 'Open conversation'}</button><button onClick={() => setFootageOpen(true)}><Film size={14} />Footage</button></div>}
    <section className="editor-body">{compact&&!p.workspaceOnly&&chat}<ResizablePanelGroup orientation="horizontal" className="editor-horizontal-panels">
      {compact||p.workspaceOnly?null:<ResizablePanel id="chat" defaultSize={p.embedded ? 356 : 400} minSize={300} maxSize={p.embedded ? 600 : undefined}>{chat}</ResizablePanel>}
      {!compact&&!p.workspaceOnly&&<ResizableHandle aria-label="Resize conversation" className="chat-resize-handle"/>}

      <ResizablePanel id="workspace" minSize={compact?0:320}><div className="editor-workspace"><ResizablePanelGroup orientation="vertical" className="editor-canvas-panels"><ResizablePanel id="preview" defaultSize="70%" minSize={180}>
        <ResizablePanelGroup orientation="horizontal" className="preview-layout"><ResizablePanel id="canvas" minSize={220}><PreviewZoomProvider canvas={dimensions(timeline.aspectRatio)}><div className="preview-workspace"><CanvasSettings inspectorOpen={compact ? false : inspectorOpen} onToggleInspector={() => setInspectorOpen(!inspectorOpen)}><AspectRatioControl value={timeline.aspectRatio} onChange={changeAspectRatio} /><PreviewZoomControls/></CanvasSettings>
        <div className="editor-stage">

          <div className="preview-player"><div className="stage-center" style={{'--preview-ratio': dimensions(timeline.aspectRatio).width / dimensions(timeline.aspectRatio).height} as React.CSSProperties}>{timeline.clips.length ? <PreviewViewport><Preview ref={preview} timeline={timeline} assets={assets} time={time} onTime={setTime} onPlaying={setPlaying} onError={onError} onRefreshMedia={p.onRefreshMedia} muted={muted} selectedClip={clip} cropping={cropping} onCropCancel={() => setCroppingClip(null)} onCropCommit={(id,crop) => { if (id === croppingClip && id === selected) { onChange(patchClip(timeline,id,{crop})); setCroppingClip(null); } }} onSelectClip={selectClip} onEditText={editText} onClipChange={(id,patch)=>onChange(patchClip(timeline,id,patch))} onVisualChange={patch=>{if(clip)onChange(patchClip(timeline,clip.id,patch));}} /></PreviewViewport> : p.aiRunning ? <div className="empty-upload" role="status"><LoaderCircle size={22} className="animate-spin"/><p>Updating your edit…</p></div> : <div className="empty-upload" role="button" tabIndex={0} onClick={browse} onKeyDown={e => { if (e.key === 'Enter') browse(); }}><div className="upload-circle"><Upload size={25} /></div><h2>Start with a moment.</h2><p>Drop your footage here,<br />then tell Revline what you have in mind.</p><Button onClick={e => { e.stopPropagation(); browse(); }} disabled={!!p.upload}>{p.upload && <LoaderCircle size={14} className="animate-spin" />}Choose files</Button><small>MP4 · MOV · WebM · JPG · PNG · Audio</small>{p.upload && <progress max="100" value={p.upload.percent} />}</div>}</div>{cropping ? <div className="preview-playback source-crop-actions" role="group" aria-label="Crop controls"><span className="source-crop-label">Crop</span><Button type="button" variant="ghost" size="sm" onClick={() => preview.current?.resetCrop()}><RotateCcw size={12}/>Reset</Button><Button type="button" variant="ghost" size="sm" onClick={() => { preview.current?.finishCrop(true); setCroppingClip(null); }}>Cancel</Button><Button type="button" size="sm" onClick={() => preview.current?.finishCrop()}>Done</Button></div> : null}</div>

        </div></div></PreviewZoomProvider></ResizablePanel>{!compact && inspectorOpen && <><ResizableHandle aria-label="Resize editing panel" className="inspector-resize-handle"/><ResizablePanel id="inspector" defaultSize={380} minSize={280} maxSize={480}><PreviewInspector sourceRequest={sourceRequest} editRequest={editRequest} onAddSubtitleStyle={addSubtitleStyle} onAddTextTemplate={addLibraryText} onAddOverlay={addOverlay} onFadeThroughBlack={fadeThroughBlack} videoImports={p.videoImports} assets={assets} upload={p.upload} onUpload={()=>setImportOpen(true)} onAdd={addAsset} clip={clip} audioClip={clip?.kind==='video'?timeline.clips.find(c=>c.id===clip.linkedClipId):undefined} asset={assets.find(a => a._id === clip?.assetId)} onChange={patch => { if (clip) onChange(patchClip(timeline, clip.id, patch)); }} onPreviewEffects={patch => { if (clip) preview.current?.clipEffects(clip.id, patch); }} onAddEffect={addEffect} onPlaybackRateChange={changeSpeed} onCrop={cropVisual} cropping={cropping} onClose={() => setInspectorOpen(false)}/></ResizablePanel></>}</ResizablePanelGroup>
        </ResizablePanel><ResizableHandle aria-label="Resize preview and timeline" className="timeline-resize-handle"/><ResizablePanel id="timeline" panelRef={timelinePanel} collapsible collapsedSize={56} defaultSize={p.embedded ? 266 : 360} minSize={160} maxSize="65%" onResize={size=>store.setState({timelineCollapsed:size.inPixels<100})}><TimelinePanel playbackControls={<EditorPlaybackControls playing={playing} time={time} duration={duration} fps={timeline.fps} readTime={readPlaybackTime} onTogglePlay={togglePlay} onPrevious={() => jumpCut(-1)} onNext={() => jumpCut(1)}/>} onPreviewVolume={(id,volume)=>preview.current?.clipVolume(id,volume)} onTogglePlay={togglePlay} muted={muted} onToggleMute={()=>{setMuted(!muted);preview.current?.mute(!muted);}} collapsed={collapsed} onToggleCollapse={toggleTimeline} timeline={timeline} assets={assets} selected={selected} onSelect={selectClip} onEditText={editText} time={time} playing={playing} readPlaybackTime={readPlaybackTime} onSeek={seek} onChange={onChange} onSplit={doSplit} onDelete={doDelete} onDuplicate={doDuplicate} onCopy={doCopy} onPaste={doPaste} canPaste={clipboard.length>0} onAddText={addText} onAddMarker={addMarker} onError={onError} />

        </ResizablePanel></ResizablePanelGroup></div></ResizablePanel></ResizablePanelGroup>
    </section></>}
    {preparing&&<ProjectImportStage importTask={p.videoImports?.find(task=>!['completed','cancelled'].includes(task.status))} upload={p.upload} onBrowse={()=>setImportOpen(true)} onUpload={p.onUpload}/>}
    {compact && inspectorOpen && <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}><SheetContent className="preview-inspector-sheet"><SheetTitle>Edit your clip</SheetTitle><SheetDescription>Select a layer to adjust it.</SheetDescription><PreviewInspector sourceRequest={sourceRequest} editRequest={editRequest} onAddSubtitleStyle={addSubtitleStyle} onAddTextTemplate={addLibraryText} onAddOverlay={addOverlay} onFadeThroughBlack={fadeThroughBlack} videoImports={p.videoImports} assets={assets} upload={p.upload} onUpload={()=>setImportOpen(true)} onAdd={addAsset} clip={clip} audioClip={clip?.kind==='video'?timeline.clips.find(c=>c.id===clip.linkedClipId):undefined} asset={assets.find(a => a._id === clip?.assetId)} onChange={patch => { if (clip) onChange(patchClip(timeline, clip.id, patch)); }} onPreviewEffects={patch => { if (clip) preview.current?.clipEffects(clip.id, patch); }} onAddEffect={addEffect} onPlaybackRateChange={changeSpeed} onCrop={cropVisual} cropping={cropping} onClose={() => setInspectorOpen(false)}/></SheetContent></Sheet>}
    <Sheet open={footageOpen} onOpenChange={setFootageOpen}><SheetContent className="footage-sheet"><SheetTitle>Footage</SheetTitle><SheetDescription>Add to this edit, or bring in something new.</SheetDescription><FootagePanel videoImports={p.videoImports} assets={assets} onUpload={()=>setImportOpen(true)} onAdd={asset=>{addAsset(asset);setFootageOpen(false);}} upload={p.upload}/></SheetContent></Sheet>
    <MediaImportDialog open={importOpen} onOpenChange={setImportOpen} onUpload={files=>{void p.onUpload(files);}} onImportVideo={p.onImportVideo} disabled={!!p.upload}/>
    <ExportDialog open={exportOpen} onOpenChange={setExportOpen} title={p.title} timeline={timeline} coverUrl={assets.find(a => a.kind === 'image')?.url} onExport={p.onExport} state={p.exportState} demo={!!p.demo} />
  </main>;
}
