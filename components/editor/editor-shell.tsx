'use client';
import { userError } from '@/lib/user-error';
import { clipExportTimeline } from '@/lib/editor/clip-export';
import { MAX_EXPORT_LABEL, MAX_EXPORT_SECONDS } from '@/lib/editor/limits';
import { addTimelineMarker } from '@/lib/editor/timeline-markers';

import { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Upload, MessageSquare, Film, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useEditorStore, useEditorState, useInspectorPlaybackTime } from './editor-state';
import { usePanelRef } from 'react-resizable-panels';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Sheet,SheetContent,SheetTitle,SheetDescription } from '@/components/ui/sheet';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import { ProjectImportStage } from './project-entry';
import { openingFootage, releaseOpeningFootage } from '@/lib/editor/footage-opening';
import { FootagePreparation } from './footage-preparation';
import { editorAudioPrepared, timelineThumbnailsPrepared, MAX_THUMBNAIL_OPENING_WAIT_MS } from '@/lib/editor/editor-opening';
import { Preview, type PreviewHandle } from './preview';
import { usePlaybackSources } from './use-playback-sources';
import { PreviewZoomProvider, PreviewViewport, PreviewFrameOverlay } from './preview-zoom';
import { CanvasSettings } from './canvas-settings';
import { AspectRatioControl } from './aspect-ratio-control';
import { MediaImportDialog } from './media-import-dialog';
import { PreviewInspector } from './preview-inspector';
import { FloatingToolsRail } from './floating-tools-rail';
import type { LibraryCategoryRequest, LibraryShortcutCategory } from './effect-library';
import { EditorPlaybackControls } from './playback-controls';
import { TimelinePanel } from './timeline';
import type { VideoImportState } from './video-link-import';
import type { UploadProgress } from './footage-panel';
import type { ClaudeModelChoice,EditorReasoningEffort,EditorSpeedMode } from '@/lib/ai/claude-model';
import { AssistantPanel, type ChatMessage } from './assistant-panel';
import type { ComposerAttachment } from '@/components/workspace/edit-composer';
import type { AssistantEditSnapshot } from './assistant-results';
import { ExportDialog, type ExportSettings, type ExportState } from './export-dialog';
import { EditorErrorNotice } from './error-notice';
import { type Timeline, type MediaAsset, type AspectRatio, type Clip, timelineDuration, dimensions } from '@/lib/editor/types';
import { addMediaClip, addTextClip, addEffectClip, convertSolidColorToVisual, setClipPlaybackRate, patchClip, frameSeekTime, linkedClipIds } from '@/lib/editor/operations';
import type { EffectPreset } from '@/lib/editor/clip-effects';
import { isTransitionPreset } from '@/lib/editor/clip-transitions';
import { placeTransitionAt } from '@/lib/editor/transition-placement';
import { addFadeThroughBlack, addOverlayClip } from '@/lib/editor/library-actions';
import { textLookPatch, type TextLookId } from '@/lib/editor/text-looks';
import { applyCaptionStyle, updateCaptionTiming } from '@/lib/editor/caption-editing';
import { copyTimelineClips, pasteTimelineClips } from '@/lib/editor/clipboard';
import type { RefreshPlaybackMedia } from '@/lib/editor/media-source-recovery';
import { MediaFileDropOverlay, useMediaFileDrop } from './media-file-drop';
import { SegmentedTabs } from './segmented-tabs';
import { useEditorModePreference } from './use-editor-mode-preference';
import { useInspectorPreference } from './use-inspector-preference';
import { TextFontStyles } from './text-font-styles';
import './editor-mode.css';
import './live-edit.css';
import type { LiveEditChange } from '@/lib/editor/live-edit';

const NO_SELECTED_CLIPS:string[]=[];
function ClockedPreviewInspector(props: React.ComponentProps<typeof PreviewInspector>) {
  const time = useInspectorPlaybackTime();
  return <PreviewInspector {...props} time={time}/>;
}
export type EditContext = { selectedClipId?: string; selectedClipIds?:string[]; playhead: number; modelChoice?: ClaudeModelChoice; reasoningEffort?: EditorReasoningEffort; speedMode?: EditorSpeedMode; retry?: boolean };
export type EditorShellProps = {
  title: string; timeline: Timeline; assets: MediaAsset[]; onChange: (t: Timeline) => void;
  onTitle: (title: string) => void; onUpload: (files: File[]) => Promise<void>;
  onDropUpload: (files: File[]) => Promise<void>;
  /** The chat's Add footage: attach to the next message without appending to the timeline. */
  onAttachUpload?: (files: File[]) => Promise<void>;
  saving: boolean; saveFailed?: boolean; onRetrySave?: () => void; upload: UploadProgress; error: string; onError: (message: string) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  conversation?:{projectId:import('@/convex/_generated/dataModel').Id<'projects'>;threadId:string}; messages: ChatMessage[]; aiRunning: boolean; aiEditing?:boolean; aiWorkflowActive?:boolean; aiConfigured: boolean; modelSwitcher?: boolean; allowedModels?:readonly ClaudeModelChoice[]; defaultModelChoice?:ClaudeModelChoice; aiError?: string | null; draftKey?:string;
  onSend: (text: string, context?: EditContext) => Promise<void>;
  composerAttachments?: ComposerAttachment[]; composerBusy?: boolean; onRemoveComposerAttachment?: (id:string)=>void;
  onStop?: () => Promise<void>;
  liveEdit?:LiveEditChange & {sequence:number;runId:string};
  canResumeEdit?:boolean;
  assistantEditSnapshot?:AssistantEditSnapshot;
  assistantPanel?: ReactNode;
  onExport: (settings: ExportSettings) => Promise<void>; onDownloadExport?: (jobId:string)=>Promise<void>; onCancelExport?: (jobId:string)=>Promise<void>; exportState: ExportState; demo?: boolean; ultra?: boolean; embedded?: boolean;
  analysisBusy?: string | null; analysisSource?: string | null; analysisProgress?: number | null; analysisStartedAt?:number|null; assistantBudgetUsed?:number; preparationActivity?:string; onLoadMore?: () => void; canLoadMore?: boolean;
  projectId?: string; workspaceOnly?: boolean; onImportVideo?: (url:string)=>Promise<void>; videoImports?: VideoImportState[];
  onRefreshMedia?:RefreshPlaybackMedia;
  onRemoveAsset?: (asset:MediaAsset)=>Promise<void>;
  onSaveThumbnail?: (assetId:string,url:string)=>void;
  onPreviewReady?: (controller:PreviewHandle)=>void;
  onRegisterStockAudio?: (catalogId:string)=>Promise<MediaAsset>;
  onShare?: () => void;
};

const TIMELINE_MIN_HEIGHT = 160;
const TIMELINE_MAX_SHARE = .65;

export function EditorShell(p: EditorShellProps) {
  const { timeline, assets, onError } = p;
  const { timelineAssets, onPlaybackAssets } = usePlaybackSources(assets);
  const retainedPreview=useRef(timeline);
  useLayoutEffect(()=>{if(timeline.clips.length||!p.liveEdit)retainedPreview.current=timeline;},[timeline,p.liveEdit]);
  const previewTimeline=p.liveEdit&&!timeline.clips.length?retainedPreview.current:timeline;
  // Status fields can arrive before the workflow flag updates. Any positive
  // run-scoped editing/analysis evidence locks interactions; a plain reply has none.
  const scriptedWorkflow = !!p.demo && p.aiWorkflowActive === undefined && p.aiEditing === undefined;
  const editing = p.aiRunning && (p.aiWorkflowActive === true || p.aiEditing === true || !!p.analysisBusy || scriptedWorkflow);
  const editLock = useRef(editing);
  const manualSession = useMemo(() => Symbol('manual-edit-session'), [editing]);
  const currentManualSession = useRef(manualSession);
  useLayoutEffect(() => { editLock.current = editing; currentManualSession.current = manualSession; }, [editing, manualSession]);
  // Gesture and async callbacks may outlive the render that started them.
  const onChange = useCallback((next: Timeline) => { if (!editLock.current && currentManualSession.current === manualSession) p.onChange(next); }, [p.onChange, manualSession]);
  const undo = useCallback(() => { if (!editLock.current) p.onUndo(); }, [p.onUndo]);
  const redo = useCallback(() => { if (!editLock.current) p.onRedo(); }, [p.onRedo]);
  function changeClip(id: string, patch: Partial<Clip>) {
    if (editLock.current) return;
    try { onChange(patchClip(timeline, id, patch)); }
    catch (error) {
      const joinedBlend = patch.blendMode !== undefined && timeline.clips.some(clip => clip.transition?.fromClipId === id || clip.transition?.toClipId === id);
      onError(userError(error, 'Could not change this clip.') + (joinedBlend ? ' Remove the transition before changing the blend mode of just one connected clip.' : ''));
    }
  }
  const usedAssetIds=useMemo(()=>timeline.clips.flatMap(clip=>clip.assetId?[clip.assetId]:[]),[timeline.clips]);
  const dismissError = useCallback(() => onError(''), [onError]);
  const params = useSearchParams();
  const [compact,setCompact]=useState(false);useEffect(()=>{const media=matchMedia('(max-width:900px)');const update=()=>setCompact(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const [importOpen,setImportOpen]=useState(false);const [importDestination,setImportDestination]=useState<'timeline'|'sources'|'composer'>('timeline');
  const store=useEditorStore();const selected=useEditorState(s=>s.selectedId);const selectedIds=useEditorState(s=>s.selectedIds??NO_SELECTED_CLIPS);const setSelected=(id:string|null)=>store.setState({selectedId:id,selectedIds:id?[id]:[]});
  const [clipboard, setClipboard] = useState<Clip[]>([]);
  useEffect(() => { setClipboard([]); }, [p.projectId]);
  const [croppingClip, setCroppingClip] = useState<string | null>(null);
  useEffect(() => { if (editing) setCroppingClip(null); }, [editing]);
  // Clock-dependent leaves subscribe to position; the workspace itself does
  // not rebuild for playback ticks or pointer scrubbing.
  const time=store.getState().playhead;const setTime=useCallback((playhead:number)=>store.setState({playhead}),[store]);
  const playing=useEditorState(s=>s.playing);const setPlaying=useCallback((playing:boolean)=>store.setState({playing}),[store]);
  const muted=useEditorState(s=>s.muted);const setMuted=(muted:boolean)=>store.setState({muted});
  const [exportOpen, setExportOpen] = useState(params.get('export') === '1');
  const [exportClipId,setExportClipId]=useState<string|null>(null);
  const exportTimeline=useMemo(()=>{if(!exportClipId)return timeline;try{return clipExportTimeline(timeline,exportClipId);}catch{return {...timeline,clips:[]};}},[timeline,exportClipId]);
  const [desktopMode, setDesktopMode] = useEditorModePreference();
  const [mobileConversation, setMobileChat] = useState(true);
  const mobileChat = compact && mobileConversation;
  const [preferredInspectorOpen, saveInspectorOpen] = useInspectorPreference();
  const [embeddedInspectorOpen, setEmbeddedInspectorOpen] = useState(params.get('panel') === 'footage');
  const inspectorOpen = p.embedded ? embeddedInspectorOpen : preferredInspectorOpen;
  const setInspectorOpen = p.embedded ? setEmbeddedInspectorOpen : saveInspectorOpen;
  useEffect(() => { if (params.get('panel') === 'footage') setInspectorOpen(true); }, [params, setInspectorOpen]);
  const inspectorRequest = useRef(params.get('panel') === 'footage' ? 1 : 0);
  const [sourceRequest, setSourceRequest] = useState(inspectorRequest.current);
  const [editRequest, setEditRequest] = useState(0);
  const [libraryCategory, setLibraryCategory] = useState<LibraryShortcutCategory>('texture');
  const [libraryRequest, setLibraryRequest] = useState<LibraryCategoryRequest>();
  function openLibraryCategory(category: LibraryShortcutCategory) {
    setLibraryCategory(category); setLibraryRequest({ category, requestId: ++inspectorRequest.current }); setInspectorOpen(true);
  }
  const fileDrop = useMediaFileDrop({ busy: !!p.upload, onUpload: files => { setSourceRequest(++inspectorRequest.current); setInspectorOpen(true); return p.onDropUpload(files); }, onError });
  const editorRoot = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const chatPanel=usePanelRef();const [chatCollapsed,setChatCollapsed]=useState(false);
  const timelinePanel=usePanelRef();const expandedTimelineHeight=useRef<number|null>(null);const collapsed=useEditorState(s=>s.timelineCollapsed);
  const toggleTimeline=()=>{
    const panel=timelinePanel.current;if(!panel)return;
    if(collapsed){if(expandedTimelineHeight.current!==null)panel.resize(expandedTimelineHeight.current);else panel.expand();}
    else{expandedTimelineHeight.current=panel.getSize().inPixels;panel.collapse();}
    store.setState({timelineCollapsed:!collapsed});
  };
  const [collapsedTimelineHeight,setCollapsedTimelineHeight]=useState(36);
  // No fixed pixel threshold separates the states: the collapsed toolbar wraps to ~121px on phones, a
  // collapsed panel drifts while its group resizes, and short viewports squeeze an expanded panel below
  // minSize. So keep the current state in between: collapse only on reaching the measured toolbar height,
  // expand only on reaching the effective minimum, min(minSize, maxSize). The toggle sets the state itself.
  const collapsedHeightRef=useRef(collapsedTimelineHeight);collapsedHeightRef.current=collapsedTimelineHeight;
  const timelineCollapsedAt=(size:{inPixels:number;asPercentage:number})=>{
    if(!store.getState().timelineCollapsed)return size.inPixels<=collapsedHeightRef.current+1;
    const group=size.asPercentage>0?size.inPixels*100/size.asPercentage:Infinity;
    return size.inPixels<Math.min(TIMELINE_MIN_HEIGHT,group*TIMELINE_MAX_SHARE)-1;
  };
  const workspace = useRef({ projectId: p.projectId, opened: false });
  if (workspace.current.projectId !== p.projectId) workspace.current = { projectId: p.projectId, opened: false };
  if (!p.upload && (timeline.clips.length || assets.length || p.canUndo || p.aiRunning)) workspace.current.opened = true;
  // Empty edits are still projects: keep the conversation, stop button and timeline mounted.
  const preparing = !p.assistantPanel && !workspace.current.opened && !p.aiRunning;
  const modeAvailable = !p.workspaceOnly && !p.embedded;
  const mode = compact ? mobileConversation ? 'agentic' : 'tracks' : desktopMode;
  const conversationVisible = compact ? mobileChat : true;
  useLayoutEffect(() => {
    if (compact || !conversationVisible) chatPanel.current?.collapse();
    else chatPanel.current?.expand();
  }, [compact, conversationVisible, preparing, chatPanel]);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => body.style.setProperty('--editor-body-height', `${body.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    measure(); observer.observe(body);
    return () => observer.disconnect();
  }, [preparing]);
  useLayoutEffect(() => {
    const toolbar=bodyRef.current?.querySelector<HTMLElement>('.timeline-toolbar');
    if(!toolbar)return;
    const measure=()=>setCollapsedTimelineHeight(Math.max(1,Math.ceil(toolbar.getBoundingClientRect().height)));
    const observer=new ResizeObserver(measure);
    measure();observer.observe(toolbar);
    return()=>observer.disconnect();
  },[preparing]);
  useLayoutEffect(()=>{
    const panel=timelinePanel.current;
    // Keep a collapsed panel fitted when its toolbar wraps to another row.
    if(collapsed&&!preparing&&panel&&Math.abs(panel.getSize().inPixels-collapsedTimelineHeight)>.5){
      // A collapsed panel re-collapses so the library applies its newly registered collapsed size;
      // resizing below minSize before that registration lands snaps the panel open instead.
      if(panel.isCollapsed())panel.collapse();else panel.resize(collapsedTimelineHeight);
    }
  },[collapsed,collapsedTimelineHeight,preparing,timelinePanel]);
  const modeSwitch = modeAvailable && !preparing ? <SegmentedTabs label="Editor mode" className="editor-mode-switch" value={mode} onChange={value => compact ? setMobileChat(value === 'agentic') : setDesktopMode(value)} options={[
    { value: 'agentic', label: 'Agentic', id: 'editor-agentic-tab', panelId: 'editor-mode-view', icon: <MessageSquare size={13}/> },
    { value: 'tracks', label: 'Tracks', id: 'editor-tracks-tab', panelId: 'editor-mode-view', icon: <Film size={13}/> },
  ]}/> : null;
  const [playbackReady,setPlaybackReady]=useState(!timeline.clips.length);
  const [loadingThumbnail,setLoadingThumbnail]=useState<string|null>(null);
  const [playbackError,setPlaybackError]=useState('');
  const [playbackSlow,setPlaybackSlow]=useState(false);
  const onSlowLoad=useCallback(()=>setPlaybackSlow(true),[]);
  const [thumbnailsReady,setThumbnailsReady]=useState(false);
  const [thumbnailsTimedOut,setThumbnailsTimedOut]=useState(false);
  const [openingAttempt,setOpeningAttempt]=useState(0);
  const [thumbnailProgress,setThumbnailProgress]=useState({ready:0,total:0});
  const firstVisualAsset=assets.find(asset=>asset._id===timeline.clips.find(clip=>clip.kind==='video'||clip.kind==='image')?.assetId);
  const onLoadingThumbnail=useCallback((url:string)=>{setLoadingThumbnail(url);if(firstVisualAsset&&!firstVisualAsset.thumbnailUrl)p.onSaveThumbnail?.(firstVisualAsset._id,url);},[firstVisualAsset,p.onSaveThumbnail]);
  const onPlaybackReady=useCallback(()=>{setPlaybackReady(true);setPlaybackError('');setPlaybackSlow(false);releaseOpeningFootage(p.projectId);if(preview.current)p.onPreviewReady?.(preview.current);},[p.projectId,p.onPreviewReady]);
  const audioPrepared=editorAudioPrepared(timeline,assets);
  const hasVisual=timeline.clips.some(clip=>clip.kind==='video'||clip.kind==='image');
  const openedOnce=useRef(false);
  const initialAnalysis=!openedOnce.current?p.preparationActivity:undefined;
  const opening=!openedOnce.current&&!p.demo&&!p.embedded&&!preparing&&timeline.clips.length>0&&(!playbackReady||!audioPrepared||!!initialAnalysis||(hasVisual&&!thumbnailsReady&&!thumbnailsTimedOut));
  useEffect(()=>{
    if(!opening||!playbackReady||!audioPrepared||initialAnalysis||thumbnailsReady)return;
    // Stills improve navigation, but a blocked decoder must not lock a playable edit.
    const timer=setTimeout(()=>setThumbnailsTimedOut(true),MAX_THUMBNAIL_OPENING_WAIT_MS);
    return()=>clearTimeout(timer);
  },[opening,playbackReady,audioPrepared,initialAnalysis,thumbnailsReady,openingAttempt]);
  useEffect(()=>{if(!preparing&&!opening&&timeline.clips.length>0)openedOnce.current=true;},[preparing,opening,timeline.clips.length]);
  const openingLog=useRef<{phase:string;started:number}|null>(null);
  useEffect(()=>{
    if(p.demo||p.embedded)return;
    const previous=openingLog.current;
    if(opening){const phase=p.preparationActivity||(!audioPrepared?'Preparing audio':!playbackReady?'Loading playback':'Loading timeline thumbnails');if(previous?.phase!==phase){const started=previous?.started??Date.now();openingLog.current={phase,started};console.info(`[import] ${new Date().toISOString()} ${phase}; editor opening ${((Date.now()-started)/1000).toFixed(1)}s.`);}}
    else if(previous){console.info(`[import] ${new Date().toISOString()} Editor ready with playback, audio and thumbnails; opening took ${((Date.now()-previous.started)/1000).toFixed(1)}s.`);openingLog.current=null;}
  },[opening,audioPrepared,playbackReady,p.demo,p.embedded,p.preparationActivity]);
  useEffect(()=>{
    if(!opening||!editorRoot.current)return;
    const root=editorRoot.current;
    const check=()=>setThumbnailsReady(timelineThumbnailsPrepared(root,(ready,total)=>setThumbnailProgress(previous=>previous.ready===ready&&previous.total===total?previous:{ready,total})));
    const observer=new MutationObserver(check);
    observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['src','data-thumbnail-exact','data-thumbnail-state']});
    const resize=new ResizeObserver(check);resize.observe(root);
    const rail=root.querySelector('.timeline-scroll');if(rail)resize.observe(rail);
    root.addEventListener('scroll',check,true);
    root.addEventListener('load',check,true);check();
    return()=>{observer.disconnect();resize.disconnect();root.removeEventListener('scroll',check,true);root.removeEventListener('load',check,true);};
  },[opening,openingAttempt,initialAnalysis,playbackReady,audioPrepared]);
  const previewError=useCallback((message:string)=>{if(!playbackReady)setPlaybackError(message);onError(message);},[playbackReady,onError]);
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
  // Moving the playhead never edits the timeline, so it stays free while the AI edits.
  const seek = useCallback((n: number) => {
    const t = frameSeekTime(n, timeline.fps, duration);
    setCroppingClip(null); setTime(t); preview.current?.seek(t);
  }, [duration, timeline.fps, setTime]);
  const changeAspectRatio = (aspectRatio: AspectRatio) => {
    if (editLock.current) return;
    preview.current?.pause();
    setCroppingClip(null);
    onChange({ ...timeline, aspectRatio });
  };

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
  const doDelete = useCallback(() => {
    if (editLock.current) return;
    const ids=new Set(linkedClipIds(timeline,selectedIds.length?selectedIds:selected?[selected]:[]));
    if(!ids.size)return;onChange({...timeline,clips:timeline.clips.filter(c=>!ids.has(c.id))});setSelected(null);setCroppingClip(null);
  }, [selected, selectedIds, timeline, onChange]);
  const addMarker = useCallback(() => {
    if (editLock.current) return;
    const current = store.getState();
    const next = addTimelineMarker(timeline, current.playing ? readPlaybackTime() : current.playhead, crypto.randomUUID());
    if (next !== timeline) onChange(next);
  }, [timeline, onChange, readPlaybackTime, store]);
  const doCopy = useCallback(() => {
    const clips = copyTimelineClips(timeline, selectedIds.length ? selectedIds : selected ? [selected] : []);
    if (clips.length) setClipboard(clips);
  }, [timeline, selectedIds, selected]);
  const pasteCopies = useCallback((clips: Clip[], at: number, visualTrack?: number) => {
    if (editLock.current) return;
    try {
      const pasted = pasteTimelineClips(timeline, clips, at, undefined, { visualTrack });
      if (!pasted.ids.length) return;
      onChange(pasted.timeline);
      store.setState({ selectedId: pasted.ids[0], selectedIds: pasted.ids });
    } catch (error) { onError(userError(error, 'Could not paste these clips.')); }
  }, [timeline, onChange, onError, store]);
  const doPaste = useCallback((at?: number, visualTrack?: number) => pasteCopies(clipboard, at ?? readPlaybackTime(), visualTrack), [clipboard, pasteCopies, readPlaybackTime]);
  const doDuplicate = () => {
    const originals = copyTimelineClips(timeline, selectedIds.length ? selectedIds : selected ? [selected] : []);
    if (originals.length) pasteCopies(originals, Math.max(...originals.map(clip => clip.start + clip.duration)));
  };

  const keyboardHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    keyboardHandler.current = (e: KeyboardEvent) => {
      if (!(e.target instanceof HTMLElement) || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      const target = e.target;
      if (p.embedded && !editorRoot.current?.contains(target)) return;
      if (target.isContentEditable || target.closest('input,textarea,select,[role="slider"],[role="menu"]')) return;
      if (cropping) { if (e.key === 'Escape') setCroppingClip(null); if (e.code === 'Space' && !target.closest('button,a,[role="button"]')) e.preventDefault(); return; }
      const dialog = target.closest('[role="dialog"]');
      if (dialog && dialog !== editorRoot.current?.closest('[role="dialog"]')) return;
      // Let focused controls keep their native Space activation. Clips handle
      // Space locally, so selecting one never toggles preview playback.
      if (e.code === 'Space' && target.closest('button,a,[role="button"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="switch"]')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (['<','>',',','.'].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        preview.current?.pause(); setPlaying(false);
        const direction = e.key === '<' || e.key === ',' ? -1 : 1;
        seek(frameSeekTime(readPlaybackTime(), timeline.fps, duration) + direction / timeline.fps);
      }
      else if (e.key.toLowerCase() === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); if (!editLock.current) store.setState({ tool: 'blade' }); }
      else if (e.key.toLowerCase() === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); store.setState({ tool: 'select' }); }
      else if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); if (!e.repeat) addMarker(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); doDelete(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); if(editLock.current)return; store.setState({selectedIds:timeline.clips.map(c=>c.id),selectedId:selected??timeline.clips[0]?.id??null}); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && (selectedIds.length || selected)) { e.preventDefault(); doCopy(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x' && (selectedIds.length || selected)) { e.preventDefault(); if (editLock.current) return; doCopy(); doDelete(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && clipboard.length) { e.preventDefault(); doPaste(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (e.key === 'Escape') { if (store.getState().tool === 'blade') { store.setState({ tool: 'select' }); return; } if(editLock.current)return; setSelected(null); if (compact) setMobileChat(false); }
    }
  });
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => keyboardHandler.current(event);
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);

  function addAsset(asset: MediaAsset) {
    if (editLock.current) return;
    try { const id = crypto.randomUUID(); onChange(addMediaClip(timeline, asset, id)); setSelected(id); }
    catch (error) { onError(userError(error, 'Could not add this source.')); }
  }
  function addSound(asset: MediaAsset) {
    if (editLock.current) return;
    try { const id=crypto.randomUUID();onChange(addMediaClip(store.getState().timeline,asset,id,readPlaybackTime()));setSelected(id); }
    catch(error) { onError(userError(error,'Could not add this sound.')); }
  }
  async function addStockAudio(catalogId: string, at: number, track = 1) {
    if (editLock.current) return;
    if (!p.onRegisterStockAudio) throw new Error('Audio FX is unavailable in this editor.');
    const projectId = p.projectId, asset = await p.onRegisterStockAudio(catalogId);
    if (workspace.current.projectId !== projectId || editLock.current) return;
    const id = crypto.randomUUID();
    onChange(addMediaClip(store.getState().timeline, asset, id, at, track));setSelected(id);
  }
  function addEffect(preset: EffectPreset) {
    if (editLock.current) return;
    try {
      const id = crypto.randomUUID();
      const at=preview.current?.currentTime()??time;
      onChange(isTransitionPreset(preset)?placeTransitionAt(timeline,id,preset,at,{aboveClipId:clip?.kind==='video'||clip?.kind==='image'?clip.id:undefined}):addEffectClip(timeline,id,preset,at,{aboveClipId:clip?.id}));
      setSelected(id);
    } catch (error) { onError(userError(error, 'Could not add this effect.')); }
  }
  function addLibraryText(look: TextLookId) { addText('graphic', { look }); }
  function addOverlay(asset: MediaAsset) {
    if (editLock.current) return;
    try {
      const id = crypto.randomUUID();
      onChange(addOverlayClip(timeline, asset, id, readPlaybackTime()));
      setSelected(id);
    } catch (error) { onError(userError(error, 'Could not add this overlay.')); }
  }
  function fadeThroughBlack() {
    if (editLock.current) return;
    if (!clip) return;
    try {
      const id = crypto.randomUUID();
      onChange(addFadeThroughBlack(timeline, clip.id, id));
      setSelected(id);
    } catch (error) { onError(userError(error, 'Could not add this transition.')); }
  }
  function changeSpeed(rate: number) {
    if (editLock.current) return;
    if (!clip) return;
    try { onChange(setClipPlaybackRate(timeline, clip.id, rate)); }
    catch (error) { onError(userError(error, 'Could not change playback speed.')); }
  }
  function openClipSettings(id: string) {
    setSelected(id); setInspectorOpen(true); setEditRequest(++inspectorRequest.current);
  }
  function editText(id: string) {
    const item = timeline.clips.find(c => c.id === id);
    if (item?.kind === 'caption' || item?.kind === 'graphic') openClipSettings(id);
  }
  function selectClip(id:string|null){
    if (id !== selected) setCroppingClip(null);
    const item = timeline.clips.find(c => c.id === id);
    if (!compact && (item?.kind === 'caption' || item?.kind === 'graphic' || item?.kind === 'effect')) openClipSettings(item.id);
    else setSelected(id);
  }
  function cropVisual() {
    if (editLock.current) return;
    if (cropping) { preview.current?.finishCrop(); return; }
    const asset = assets.find(item => item._id === clip?.assetId);
    if (!clip || (clip.kind !== 'video' && clip.kind !== 'image') || !asset?.width || !asset?.height || !asset.url) return;
    preview.current?.pause();
    const current = readPlaybackTime();
    if (current < clip.start || current >= clip.start + clip.duration) seek(Math.ceil((clip.start - 1e-7) * timeline.fps) / timeline.fps);
    setCroppingClip(clip.id);
    if (compact) setInspectorOpen(false);
  }
  function addText(kind: 'caption' | 'graphic', options: { look?: TextLookId } = {}) {
    if (editLock.current) return;
    try {
      const id = crypto.randomUUID();
      let next = addTextClip(timeline, id, kind, readPlaybackTime());
      if (options.look) next = patchClip(next, id, textLookPatch(next.clips.find(item => item.id === id)!, options.look));
      onChange(next); openClipSettings(id);
    } catch (error) { onError(userError(error, 'Could not add this text.')); }
  }
  const captionActions = clip?.kind === 'caption' ? { fps: timeline.fps, count: timeline.clips.filter(item => item.kind === 'caption').length, onTiming: (changes: { start?: number; end?: number }) => onChange(updateCaptionTiming(timeline, clip.id, changes)), onApplyStyle: () => onChange(applyCaptionStyle(timeline, clip.id)) } : undefined;
  const browse = () => { setImportDestination('timeline');setImportOpen(true); };
  const browseSources=()=>{setImportDestination('sources');setImportOpen(true);};
  const browseComposer=()=>{setImportDestination('composer');setImportOpen(true);};

  const inspector = <ClockedPreviewInspector backgroundRemoval={p.ultra && p.projectId && !p.demo ? { projectId: p.projectId as import('@/convex/_generated/dataModel').Id<'projects'> } : undefined} onClose={compact ? undefined : () => setInspectorOpen(false)} readOnly={editing} timeline={timeline} time={time} onSeek={seek} onAddTransition={addEffect} onRemoveAsset={p.onRemoveAsset} usedAssetIds={usedAssetIds} sourceRequest={sourceRequest} editRequest={editRequest} libraryRequest={libraryRequest} onLibraryCategoryChange={setLibraryCategory} onAddTextLook={addLibraryText} captionActions={captionActions} onAddOverlay={addOverlay} onFadeThroughBlack={fadeThroughBlack} videoImports={p.videoImports} assets={assets} upload={p.upload} onUpload={browseSources} onAdd={addAsset} onAddSound={addSound} onAddStockAudio={p.onRegisterStockAudio ? catalogId=>addStockAudio(catalogId,readPlaybackTime()) : undefined} clip={clip} audioClip={clip?.kind==='video'?timeline.clips.find(c=>c.id===clip.linkedClipId):undefined} asset={assets.find(a => a._id === clip?.assetId)} onChange={patch => { if (clip) changeClip(clip.id, patch); }} onPreviewEffects={patch => { if (clip && (patch === null || !editLock.current)) preview.current?.clipEffects(clip.id, patch); }} onAddEffect={addEffect} onConvertSolidColor={() => { if (clip) onChange(convertSolidColorToVisual(timeline,clip.id)); }} onPlaybackRateChange={changeSpeed} onCrop={cropVisual} cropping={cropping}/>;

  // On desktop the ratio chip sits on the preview frame's top-left corner, as in the design.
  const ratioOnFrame = !compact && !!previewTimeline.clips.length;
  const ratioControl = <AspectRatioControl value={timeline.aspectRatio} onChange={changeAspectRatio} />;
  const chat=(<aside className={`editor-sidebar ${mobileChat ? 'mobile-open' : ''}`} aria-label="Editing conversation" hidden={!conversationVisible}>
        {p.assistantPanel ?? <AssistantPanel attachments={p.composerAttachments} composerBusy={p.composerBusy} onRemoveAttachment={p.onRemoveComposerAttachment} conversation={p.conversation} editSnapshot={p.assistantEditSnapshot} canResumeEdit={p.canResumeEdit} messages={p.messages} running={p.aiRunning} editing={editing} configured={p.aiConfigured} modelSwitcher={p.modelSwitcher} allowedModels={p.allowedModels} defaultModelChoice={p.defaultModelChoice} error={p.aiError} onSend={(text, modelChoice, reasoningEffort, speedMode) => p.onSend(text, { modelChoice, reasoningEffort, speedMode, selectedClipId: clip?.id, selectedClipIds:selectedIds, playhead: readPlaybackTime() })} onRetry={(text, modelChoice, reasoningEffort, speedMode) => p.onSend(text, { modelChoice, reasoningEffort, speedMode, playhead: readPlaybackTime(), retry: true })} onStop={p.onStop} hasClips={!!timeline.clips.length} demo={!!p.demo} onLoadMore={p.onLoadMore} canLoadMore={p.canLoadMore} onAttach={browseComposer} activity={p.analysisBusy} activitySource={p.analysisSource} activityProgress={p.analysisProgress} activityStartedAt={p.analysisStartedAt} budgetUsed={p.assistantBudgetUsed} draftKey={p.draftKey} suggestions={sourceSuggestions} onSuggestion={async (text, clipId, modelChoice, reasoningEffort, speedMode) => { const target = timeline.clips.find(item => item.id === clipId && item.kind === 'video'); if (!target) throw new Error('This clip is no longer on the timeline.'); setSelected(clipId); await p.onSend(text, { modelChoice, reasoningEffort, speedMode, selectedClipId: clipId, selectedClipIds: [clipId], playhead: target.start }); }} />}
      </aside>);
  return <main ref={editorRoot} data-playback-opening={opening} tabIndex={-1} {...fileDrop.handlers} onPointerDownCapture={e => { const interactive = (e.target as HTMLElement).closest('input,textarea,button,a,select,[tabindex]'); if (p.embedded) { if (!interactive || interactive === e.currentTarget || !e.currentTarget.contains(interactive)) editorRoot.current?.focus({ preventScroll: true }); else if (interactive.matches('[tabindex]') && !interactive.matches('input,textarea,button,a,select')) (interactive as HTMLElement).focus({ preventScroll: true }); } }} className={`editor-app conversation-editor ${p.embedded ? 'embedded-editor' : ''}`}>
    <TextFontStyles/>
    <MediaFileDropOverlay active={fileDrop.active} busy={!!p.upload}/>
    {!p.workspaceOnly && <WorkspaceNav chatId={p.demo ? undefined : p.projectId} title={p.title} onRename={p.onTitle} onShare={p.onShare} shareDisabled={!timeline.clips.length || editing} onExport={() => {setExportClipId(null);setExportOpen(true);}} exportDisabled={!timeline.clips.length} exportHint={!timeline.clips.length?'Add a clip to export':duration>MAX_EXPORT_SECONDS?`Exports support up to ${MAX_EXPORT_LABEL}. Shorten the edit to export.`:`Export an MP4 up to ${MAX_EXPORT_LABEL} long`} saving={p.saving} saveFailed={p.saveFailed} onRetrySave={p.onRetrySave} demo={p.demo} editorControls={compact ? undefined : modeSwitch}/>}

    <EditorErrorNotice message={p.error} onDismiss={dismissError} />
    {!preparing&&<>{compact&&!p.workspaceOnly && <div className="mobile-panel-controls">{modeSwitch || <button aria-expanded={mobileChat} onClick={() => setMobileChat(!mobileChat)}><MessageSquare size={14} />{mobileChat ? 'Back to preview' : 'Open conversation'}</button>}<button onClick={() => { setSourceRequest(++inspectorRequest.current); setInspectorOpen(true); }}><Film size={14} />My media</button></div>}
    <section ref={bodyRef} id="editor-mode-view" data-mode={mode} className="editor-body" role={modeSwitch ? "tabpanel" : undefined} aria-labelledby={modeSwitch ? `editor-${mode}-tab` : undefined} aria-hidden={opening} inert={opening}><ResizablePanelGroup orientation="vertical" className="editor-canvas-panels"><ResizablePanel id="preview" className="editor-preview-row" defaultSize="70%" minSize={180}><ResizablePanelGroup orientation="horizontal" className="editor-horizontal-panels">
      {/* Dragging keeps the chat between 300 and 600px; only phone layouts collapse it. */}
      {p.workspaceOnly?null:<ResizablePanel id="chat" className="editor-chat-panel" onResize={size => { bodyRef.current?.style.setProperty('--editor-chat-width', `${size.inPixels}px`); bodyRef.current?.style.setProperty('--editor-chat-divider', size.inPixels ? '1px' : '0px'); setChatCollapsed(size.inPixels === 0); }} panelRef={chatPanel} collapsible={compact || !conversationVisible} collapsedSize={0} defaultSize={p.embedded ? 356 : 400} minSize={300} maxSize={600}>{chat}</ResizablePanel>}
      {!p.workspaceOnly&&<ResizableHandle aria-label="Resize conversation" className="chat-resize-handle" disabled={compact || !conversationVisible} style={compact || !conversationVisible ? {display:"none"} : undefined}/>}

      <ResizablePanel id="workspace" minSize={compact?0:320}><div className="editor-workspace">
        <ResizablePanelGroup orientation="horizontal" className="preview-layout"><ResizablePanel id="canvas" minSize={220}><PreviewZoomProvider canvas={dimensions(timeline.aspectRatio)}><div className="preview-workspace"><CanvasSettings onShowChat={!compact && !p.workspaceOnly && chatCollapsed ? () => chatPanel.current?.expand() : undefined}>{!ratioOnFrame && ratioControl}</CanvasSettings>
        <div className="editor-stage">
          {!compact && !inspectorOpen && <FloatingToolsRail category={libraryCategory} onCategory={openLibraryCategory} onExpand={() => openLibraryCategory(libraryCategory)}/>}

          <div className="preview-player"><div className="stage-center" data-ratio-on-frame={ratioOnFrame || undefined} style={{'--preview-ratio': dimensions(timeline.aspectRatio).width / dimensions(timeline.aspectRatio).height} as React.CSSProperties}>{previewTimeline.clips.length ? <><PreviewViewport><Preview onPlaybackAssets={onPlaybackAssets} onSlowLoad={onSlowLoad} onReady={onPlaybackReady} onThumbnail={onLoadingThumbnail} debugId={p.projectId} ref={preview} timeline={previewTimeline} assets={assets} time={time} onTime={setTime} onPlaying={setPlaying} onError={previewError} onRefreshMedia={p.onRefreshMedia} muted={muted} selectedClip={editing ? undefined : clip} cropping={cropping && !editing} onCropCancel={() => setCroppingClip(null)} onCropCommit={(id,crop) => { if (id === croppingClip && id === selected) { changeClip(id,{crop}); setCroppingClip(null); } }} onSelectClip={selectClip} onEditClip={openClipSettings} onEditText={editText} onClipChange={changeClip} onVisualChange={patch=>{if(clip)changeClip(clip.id,patch);}} /></PreviewViewport><PreviewFrameOverlay above={ratioOnFrame ? ratioControl : undefined}/></> : editing ? <div className="empty-upload" role="status"><LoaderCircle size={22} className="animate-spin"/><p>Updating your edit…</p></div> : <div className="empty-upload"><div className="upload-circle"><Upload size={25} /></div><h2>Start with a moment.</h2><p>Drop your footage here,<br />then tell Revline what you have in mind.</p><Button onClick={e => { e.stopPropagation(); browse(); }} disabled={!!p.upload}>{p.upload && <LoaderCircle size={14} className="animate-spin" />}Choose files</Button><small>MP4 · MOV · WebM · JPG · PNG · Audio</small>{p.upload && <progress max="100" value={p.upload.percent} />}</div>}</div>{cropping ? <div className="preview-playback source-crop-actions" role="group" aria-label="Crop controls"><span className="source-crop-label">Crop</span><Button type="button" variant="ghost" size="sm" onClick={() => preview.current?.resetCrop()}><RotateCcw size={12}/>Reset</Button><Button type="button" variant="ghost" size="sm" onClick={() => { preview.current?.finishCrop(true); setCroppingClip(null); }}>Cancel</Button><Button type="button" size="sm" onClick={() => preview.current?.finishCrop()}>Done</Button></div> : null}</div>

        </div></div></PreviewZoomProvider></ResizablePanel>{!compact && inspectorOpen && <><ResizableHandle aria-label="Resize editing panel" className="inspector-resize-handle"/><ResizablePanel id="inspector" defaultSize={480} minSize={320} maxSize={680}>{inspector}</ResizablePanel></>}</ResizablePanelGroup>
        </div></ResizablePanel></ResizablePanelGroup></ResizablePanel><ResizableHandle aria-label="Resize preview and timeline" className="timeline-resize-handle"/><ResizablePanel id="timeline" panelRef={timelinePanel} collapsible collapsedSize={collapsedTimelineHeight} defaultSize={p.embedded ? 266 : 360} minSize={TIMELINE_MIN_HEIGHT} maxSize={`${TIMELINE_MAX_SHARE*100}%`} onResize={size=>{const isCollapsed=timelineCollapsedAt(size);if(!isCollapsed)expandedTimelineHeight.current=size.inPixels;store.setState({timelineCollapsed:isCollapsed});}}><div className="editor-timeline-content"><TimelinePanel onUndo={undo} onRedo={redo} canUndo={p.canUndo && !editing} canRedo={p.canRedo && !editing} key={openingAttempt} liveEdit={p.liveEdit} onExportClip={p.demo?undefined:id=>{setExportClipId(id);setExportOpen(true);}} aiWorking={editing} editingLocked={editing} onAddStockAudio={p.onRegisterStockAudio ? addStockAudio : undefined} playbackControls={<EditorPlaybackControls playing={playing} time={time} duration={duration} fps={timeline.fps} readTime={readPlaybackTime} onTogglePlay={togglePlay} onPrevious={() => jumpCut(-1)} onNext={() => jumpCut(1)}/>} onPreviewVolume={(id,volume)=>preview.current?.clipVolume(id,volume)} onTogglePlay={togglePlay} muted={muted} onToggleMute={()=>{setMuted(!muted);preview.current?.mute(!muted);}} collapsed={collapsed} onToggleCollapse={toggleTimeline} timeline={timeline} assets={timelineAssets} selected={selected} onSelect={selectClip} onEditText={editText} onEditClip={openClipSettings} time={time} playing={playing} readPlaybackTime={readPlaybackTime} onSeek={seek} onChange={onChange} onDelete={doDelete} onDuplicate={doDuplicate} onCopy={doCopy} onPaste={doPaste} canPaste={clipboard.length>0} onAddText={addText} onAddMarker={addMarker} onError={onError} />

        </div></ResizablePanel></ResizablePanelGroup>
    </section></>}
    {opening&&<FootagePreparation thumbnail={firstVisualAsset?.thumbnailUrl||(firstVisualAsset?.kind==='image'?firstVisualAsset.url:null)||openingFootage(p.projectId)?.thumbnail||loadingThumbnail} fileName={openingFootage(p.projectId)?.fileName} label={!playbackReady?'Loading footage…':!audioPrepared?'Preparing audio…':initialAnalysis||'Preparing timeline thumbnails…'} detail={playbackSlow&&!playbackReady?'Still loading the video. The editor will open when it is ready.':playbackReady&&audioPrepared&&!initialAnalysis&&thumbnailProgress.total?`${thumbnailProgress.ready} of ${thumbnailProgress.total} visible thumbnails loaded.`:undefined} error={playbackError} onRetry={()=>{setPlaybackError('');setPlaybackSlow(false);onError('');setOpeningAttempt(value=>value+1);preview.current?.retry();}}/>}
    {preparing&&<ProjectImportStage importTask={p.videoImports?.find(task=>!['completed','cancelled'].includes(task.status))} upload={p.upload} onBrowse={browse} onUpload={p.onUpload}/>}
    {compact && inspectorOpen && <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}><SheetContent className="preview-inspector-sheet" showCloseButton={false}><div className="mobile-inspector-header"><SheetTitle>Tools and My media</SheetTitle><Button type="button" variant="ghost" size="icon" aria-label="Close editing panel" onClick={() => setInspectorOpen(false)}><X size={18}/></Button></div><SheetDescription>Choose media or adjust your selected clip.</SheetDescription>{inspector}</SheetContent></Sheet>}
    <MediaImportDialog open={importOpen} onOpenChange={setImportOpen} onUpload={files=>{void (importDestination==='composer'?p.onAttachUpload??p.onDropUpload:editLock.current||importDestination==='sources'?p.onDropUpload:p.onUpload)(files);}} onImportVideo={editing?undefined:p.onImportVideo} disabled={!!p.upload}/>
    <ExportDialog ultra={p.ultra} open={exportOpen} onOpenChange={setExportOpen} title={exportClipId?`${p.title} clip`:p.title} timeline={exportTimeline} clipOnly={!!exportClipId} coverUrl={assets.find(a => a.kind === 'image')?.url} onExport={settings=>p.onExport({...settings,...(exportClipId?{clipId:exportClipId}:{})})} onCancel={p.onCancelExport} onDownload={p.onDownloadExport} state={p.exportState?{...p.exportState,current:p.exportState.current&&(p.exportState.sourceClipId??null)===exportClipId}:null} demo={!!p.demo} />
  </main>;
}
