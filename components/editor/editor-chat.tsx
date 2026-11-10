'use client';
// The AI Editor's conversation view: the project's own conversation and agent run (the one the editor's assistant
// panel shows) in a centred column, with the finished clips playable in the chat. It takes the editor shell's
// props from the same connected project, so there is one chat system; only the frame around it differs.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import { timelineDuration, normalizeTimeline, type MediaAsset, type Timeline } from '@/lib/editor/types';
import { timelineCover } from '@/lib/editor/timeline-cover';
import { projectEditorPath } from '@/lib/editor/results-view';
import { AssistantPanel } from './assistant-panel';
import { ChatClips, type ChatClip } from './chat-clips';
import { EditorErrorNotice } from './error-notice';
import { ExportDialog, type ExportSettings } from './export-dialog';
import { MediaImportDialog } from './media-import-dialog';
import { MediaFileDropOverlay, useMediaFileDrop } from './media-file-drop';
import { ResultsControl, useResultsView } from './results-control';
import type { EditorShellProps } from './editor-shell';
import './editor-chat.css';

export type EditorChatProps = EditorShellProps & {
  /** The stored timelines of the tabs that are not open, so every clip can be shown and played. */
  tabTimelines?: { id: string; timeline: Timeline }[];
};

export function EditorChat(p: EditorChatProps) {
  const router = useRouter();
  const { timeline, assets, onError } = p;
  const [resultsView, setResultsView] = useResultsView();
  // The editor reports itself opened once playback is ready; the conversation view is open as soon as it shows,
  // which is what starts each video's overview.
  const opened = p.onOpened;
  useEffect(() => { opened?.(); }, [opened]);
  const [importOpen, setImportOpen] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const aiWorking = !!p.externalAgent || !!p.aiRunning && (p.aiWorkflowActive === true || p.aiEditing === true || !!p.analysisBusy);
  const tabs = useMemo(() => p.timelineTabs ?? [], [p.timelineTabs]), activeTabId = tabs.find(tab => tab.active)?.id;
  // One clip per timeline tab that has something on it; the open tab is the live timeline.
  const clips = useMemo<ChatClip[]>(() => {
    const stored = new Map((p.tabTimelines ?? []).map(item => [item.id, item.timeline]));
    const all = tabs.length ? tabs.map(tab => ({ id: tab.id, name: tab.name, timeline: tab.active ? timeline : stored.get(tab.id) })) : [{ id: 'main', name: p.title, timeline }];
    return all.flatMap(item => item.timeline?.clips.length ? [{ id: item.id, name: item.name, timeline: item.id === activeTabId || !tabs.length ? item.timeline : normalizeTimeline(item.timeline) }] : []);
  }, [tabs, p.tabTimelines, timeline, activeTabId, p.title]);
  const [exportTabs, setExportTabs] = useState<string[]>([]);
  useEffect(() => { if (exportOpen) setExportTabs(clips.map(clip => clip.id)); }, [exportOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const multiTab = tabs.length > 1;
  const startExports = async (settings: ExportSettings): Promise<string[]> => {
    const started: string[] = [];
    for (const timelineId of multiTab ? exportTabs : [undefined]) { const id = await p.onExport({ ...settings, ...(timelineId ? { timelineId } : {}) }); if (id) started.push(id); }
    return started;
  };
  const openTimeline = (clipId?: string) => {
    const go = () => router.push(projectEditorPath(p.projectId!));
    // Opening a clip's own tab first, so the editor shows the clip that was picked.
    if (clipId && clipId !== activeTabId && p.timelineTabActions && !aiWorking) void p.timelineTabActions.onOpen(clipId).then(go, go); else go();
  };
  const fileDrop = useMediaFileDrop({ busy: !!p.upload, onUpload: files => (p.onAttachUpload ?? p.onDropUpload)(files), onError });
  const exportCover = useMemo(() => timelineCover(timeline, assets), [timeline, assets]);
  const duration = timelineDuration(timeline);
  return <div className="workspace-page editor-chat" {...fileDrop.handlers}>
    <WorkspaceNav title="AI Editor" />
    <MediaFileDropOverlay active={fileDrop.active} busy={!!p.upload} />
    <EditorErrorNotice message={p.error} onDismiss={() => onError('')} />
    <div className="editor-chat-column">
      <AssistantPanel composerNote={p.composerNote} externalAgent={p.externalAgent} attachments={p.composerAttachments} composerBusy={p.composerBusy} onRemoveAttachment={p.onRemoveComposerAttachment} conversation={p.conversation} editSnapshot={p.assistantEditSnapshot} canResumeEdit={p.canResumeEdit} messages={p.messages} running={p.aiRunning} editing={aiWorking} configured={p.aiConfigured} settings={p.assistantSettings} error={p.aiError}
        onSend={(text, modelChoice, reasoningEffort, speedMode) => p.onSend(text, { modelChoice, reasoningEffort, speedMode, playhead: 0 })}
        onRetry={promptMessageId => p.onSend('', { playhead: 0, retryPromptMessageId: promptMessageId })}
        onStop={p.onStop} hasClips={!!timeline.clips.length} demo={false} onLoadMore={p.onLoadMore} canLoadMore={p.canLoadMore} onAttach={() => setImportOpen(true)}
        activity={p.analysisBusy} activitySource={p.analysisSource} activityProgress={p.analysisProgress} activityStartedAt={p.analysisStartedAt} budgetUsed={p.assistantBudgetUsed} draftKey={p.draftKey}
        composerPlaceholder="Ask for a change" composerExtra={<ResultsControl value={resultsView} onChange={next => { setResultsView(next); if (next === 'timeline' && p.projectId) router.push(projectEditorPath(p.projectId)); }} />}
        results={clips.length ? <ChatClips clips={clips} assets={assets} onOpenTimeline={openTimeline} onExportAll={() => setExportOpen(true)} post={p.navActions} onRefreshMedia={p.onRefreshMedia} /> : undefined} />
    </div>
    <MediaImportDialog open={importOpen} onOpenChange={setImportOpen} onUpload={files => { void (p.onAttachUpload ?? p.onDropUpload)(files); }} onImportVideo={aiWorking ? undefined : p.onImportVideo} disabled={!!p.upload}
      {...(p.onAttachAsset ? { projectMedia: assets.filter(asset => asset.url && !asset.preparation && !assets.some(video => video.audioAssetId === asset._id) && !p.composerAttachments?.some(item => item.id === asset._id)), onPickProjectMedia: (asset: MediaAsset) => p.onAttachAsset!(asset._id) } : {})} />
    <ExportDialog ultra={p.ultra} open={exportOpen} onOpenChange={setExportOpen} title={multiTab ? `${p.title} · ${exportTabs.length} ${exportTabs.length === 1 ? 'video' : 'videos'}` : p.title} timeline={timeline} coverUrl={exportCover} onExport={startExports} onCancel={p.onCancelExport} onDownload={p.onDownloadExport} state={multiTab ? null : p.exportState} demo={false}
      videoCount={multiTab ? Math.max(1, exportTabs.length) : 1} timelines={multiTab ? tabs.map(tab => ({ id: tab.id, name: tab.name, aspectRatio: tab.active ? timeline.aspectRatio : tab.aspectRatio, duration: tab.active ? duration : tab.duration, cover: tab.active ? exportCover : tab.cover })) : []} selectedTimelines={exportTabs} onSelectTimelines={setExportTabs}
      exports={(p.exports ?? []).map(job => ({ id: job.requestId!, status: job.status, progress: job.progress, label: job.label, createdAt: job.createdAt ?? 0, resolution: job.resolution, sourceClipId: job.sourceClipId, aspectRatio: job.sourceTimelineId === activeTabId ? timeline.aspectRatio : tabs.find(tab => tab.id === job.sourceTimelineId)?.aspectRatio }))} />
  </div>;
}
