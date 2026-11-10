'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import { userError } from '@/lib/user-error';

import { NEW_WORKSPACE_LABEL } from '@/lib/editor/workspace-labels';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useConvex, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { AspectRatio } from '@/lib/editor/types';
import { createProjectImportSession, type ImportFile, type ProjectImportProgress } from '@/lib/editor/project-import';
import { clearProjectImportJob, getOrCreateProjectImportJob, getProjectImportJob } from '@/lib/editor/project-import-job';
import { uploadSourceFile } from '@/lib/editor/upload-source';
import { useSourceUpload } from '@/components/editor/use-source-upload';
import { prepareMediaForEditing } from '@/lib/editor/prepare-media-for-editing';
import { useMediaFileDrop } from '@/components/editor/media-file-drop';
import { rememberOpeningFootage } from '@/lib/editor/footage-opening';
import { clearNewProjectDraft, clearNewProjectSources, newProjectBrief, newProjectCloudFootage, newProjectComposerKey, newProjectLinkImports, saveNewProjectLinkImports, rememberOpeningRequest, saveNewProjectBrief, saveNewProjectCloudFootage } from '@/lib/editor/opening-request';
import { useAssistantComposerControls } from '@/components/editor/assistant-composer-controls';
import { Plus, Upload, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { isVideoLinkOnly } from '@/lib/editor/video-link';
import { ComposerLinkShelf, type LinkImportProgress } from './composer-link-shelf';
import { importErrorMessage } from '@/components/editor/video-link-import';
import { normalizeMediaFile } from '@/lib/editor/media-file';
import { EditComposer } from './edit-composer';
import { ResultsControl, useResultsView } from '@/components/editor/results-control';
import { projectPath } from '@/lib/editor/results-view';
import { ConversationStart } from './conversation-start';
import { FootageProcessingCard, type FootageProcessingFile, type FootageProcessingPhase } from './footage-processing-card';
import { WorkspaceNav, chatRecency, useWorkspaceChats } from './workspace-nav';
import { ProjectCover } from './project-cover';
import { acknowledgeDraftFiles, prepareExternalAuthRedirect, stashFiles, takeFiles } from '@/lib/editor/project-draft';
import { NEW_WORKSPACE_EVENT } from './start-new-workspace';
import './shared.css';
import './new-conversation.css';

type Processing = Omit<ProjectImportProgress, 'phase'> & { phase: FootageProcessingPhase };

/** Recent projects on the start page, in one page; older ones are under "See all chats". */
const RECENT_PROJECTS = 20;

export function NewConversation() {
  const router = useRouter();
  const convex = useConvex();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const picker=useRef<HTMLInputElement>(null);
  const [linkShelf, setLinkShelf] = useState({ open: false, prefill: '', focusKey: 0 });
  const declinedLink = useRef('');
  const focusLinkAfterMenu = useRef(false);
  const importVideo = useMutation(api.mediaTasks.importVideo);
  const cancelMediaTask = useMutation(api.mediaTasks.cancel);
  const removeProject = useMutation(api.projects.remove);
  // A link imports into a holding project of its own. Its video then joins the draft as saved footage
  // (`cloudIds`), so the edit's project is created on send exactly as for uploads and the holder is removed.
  const [linkImporting, setLinkImporting] = useState(false);
  const [linkImport, setLinkImport] = useState<{ projectId: Id<'projects'>; taskId: Id<'mediaTasks'> } | null>(null);
  const linkTask = useQuery(api.mediaTasks.get, linkImport ? { taskId: linkImport.taskId } : 'skip');
  const linkSettle = useRef<{ resolve: () => void; reject: (cause: Error) => void } | null>(null);
  const [linkHolders, setLinkHolders] = useState<Record<string, Id<'projects'>>>({});
  // Send was pressed while a link was still importing: the edit starts once its footage has arrived.
  const [sendAfterImport, setSendAfterImport] = useState(false);
  const sendWaiter = useRef<(() => void) | null>(null);
  const createProject = useMutation(api.projects.create);
  const saveTimeline = useMutation(api.projects.saveTimeline);
  const sourceUpload = useSourceUpload();
  const submitting = useRef(false);
  const unsavedSignInWarned = useRef(false);
  const mounted = useRef(false);
  const unsubscribe = useRef<(() => void) | null>(null);
  const draftEpoch = useRef(0);
  const restore = useRef<Promise<File[]> | null>(null);
  const session = useRef(createProjectImportSession());
  const brief = useRef('');
  const [draftReady, setDraftReady] = useState(false);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const posters = useRef(new Map<File, Blob>());
  const posterUrls = useRef(new Set<string>());
  const [previews, setPreviews] = useState<FootageProcessingFile[]>([]);
  const [cloudIds, setCloudIds] = useState<Id<'assets'>[]>([]);
  const cloudMedia = useQuery(api.assets.selected, isAuthenticated && cloudIds.length ? { assetIds: cloudIds } : 'skip');
  const [processing, setProcessing] = useState<Processing | null>(null);
  const [error, setError] = useState('');
  const [startingBlank, setStartingBlank] = useState(false);
  const [draft, setDraft] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('landscape');
  const hasMedia = files.length + cloudIds.length > 0;
  const busy = startingBlank || sendAfterImport || processing !== null && processing.phase !== 'error';
  const { chats: workspaceChats, loading: projectsLoading } = useWorkspaceChats(false, !processing, RECENT_PROJECTS);
  const holderIds: string[] = [...Object.values(linkHolders), ...(linkImport ? [linkImport.projectId] : [])];
  const recentProjects = workspaceChats.filter(project => !holderIds.includes(project.id));
  const showRecentProjects = projectsLoading || recentProjects.length > 0;
  const settings = useQuery(api.assistant.composerSettings, isAuthenticated ? {} : 'skip');
  // After a message: the conversation view, or straight to the full editor, as the user last chose.
  const [resultsView, setResultsView] = useResultsView();
  const composerControls = useAssistantComposerControls({ settings: settings ?? {}, draftKey: userId ? newProjectComposerKey(userId) : undefined, disabled: !draftReady || busy || !settings });

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; unsubscribe.current?.(); }; }, []);
  useEffect(() => {
    const fresh = () => { reset(); setDraftReady(true); };
    window.addEventListener(NEW_WORKSPACE_EVENT, fresh);
    return () => window.removeEventListener(NEW_WORKSPACE_EVENT, fresh);
  }, [userId]);

  useEffect(() => {
    if (!isLoaded) return;
    try { brief.current = newProjectBrief(); } catch { /* Uploads can still start in this page. */ }
    setDraft(brief.current);
    const job = getProjectImportJob(userId ?? undefined);
    if (job) {
      session.current = job.session;
      if (job.input.aspectRatio) setAspectRatio(job.input.aspectRatio);
      setFiles(job.input.files);
      setCloudIds(job.input.assetIds);
      setProcessing(job.progress);
      setError(job.error ?? '');
      setDraftReady(true);
      return;
    }
    try {
      const saved = newProjectCloudFootage();
      if (saved) setCloudIds(saved);
      setLinkHolders(newProjectLinkImports());
    } catch { /* Saved uploads can be chosen again. */ }
    let active = true;
    const epoch = draftEpoch.current;
    restore.current ??= takeFiles();
    void restore.current.then(async pending => {
      if (!active) return;
      if (draftEpoch.current !== epoch) { setDraftReady(true); return; }
      if (pending.length) {
        setFiles(pending.map(file => ({ id: crypto.randomUUID(), file })));
        await stashFiles(pending);
      }
      setDraftReady(true);
    }).catch(() => { if (active && draftEpoch.current === epoch) { setError('Could not restore your footage. Please add it again.'); setDraftReady(true); } });
    return () => { active = false; };
  }, [isLoaded, userId]);

  useEffect(() => {
    const items = files.map(({ id, file }): FootageProcessingFile => ({ id, name: file.name, kind: file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image', url: URL.createObjectURL(file) }));
    setPreviews(items);
    return () => { for (const item of items) if (item.url) URL.revokeObjectURL(item.url); for (const url of posterUrls.current) URL.revokeObjectURL(url); posterUrls.current.clear(); posters.current.clear(); };
  }, [files]);

  function attach(incoming: File[]) {
    if (busy || submitting.current) return;
    const accepted = incoming.map(normalizeMediaFile).filter((file): file is File => !!file);
    if (!accepted.length) { setError('Choose a nonempty video, audio, or image file.'); return; }
    const combined = [...files.map(item => item.file), ...accepted];
    const unique = combined.filter((file, index) => combined.findIndex(other => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified) === index);
    if (unique.length + cloudIds.length > 200) { setError('Choose up to 200 media files for this edit.'); return; }
    const previousJob = getProjectImportJob(userId ?? undefined);
    if (previousJob) clearProjectImportJob(previousJob);
    session.current = createProjectImportSession();
    draftEpoch.current++;
    setDraftReady(true);
    setFiles(unique.map(file => files.find(item => item.file === file) ?? { id: crypto.randomUUID(), file }));
    setError(accepted.length !== incoming.length ? 'Unsupported or empty files were skipped.' : '');
    setProcessing(null);
    void stashFiles(unique).catch(() => { /* The in-memory files can still upload in this page. */ });
  }

  useEffect(() => {
    function paste(event: ClipboardEvent) {
      const incoming = Array.from(event.clipboardData?.files ?? []);
      if (!incoming.length) return;
      event.preventDefault();
      attach(incoming);
    }
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [files, cloudIds, busy, userId]);

  function removeAttachment(id: string) {
    if (busy || submitting.current) return;
    draftEpoch.current++;
    const remaining = files.filter(item => item.id !== id);
    const remainingCloud = cloudIds.filter(value => value !== id);
    setFiles(remaining); setCloudIds(remainingCloud); setError('');
    try { saveNewProjectCloudFootage(remainingCloud); } catch { /* The selection stays in memory. */ }
    // Removing link-imported footage discards the import with its holding project.
    if (linkHolders[id]) { discardHolders([linkHolders[id]]); keepLinkHolders(Object.fromEntries(Object.entries(linkHolders).filter(([assetId]) => assetId !== id))); }
    void stashFiles(remaining.map(item => item.file));
  }

  async function processFootage() {
    if (submitting.current || !hasMedia || !isLoaded || authLoading) return;
    if (!isSignedIn) {
      // Promise persistence only after the files reached durable browser storage.
      let kept = true;
      submitting.current = true;
      try { await prepareExternalAuthRedirect(); } catch { kept = false; } finally { submitting.current = false; }
      setProcessing({ phase: 'error', index: 1, total: files.length + cloudIds.length, percent: 0 });
      if (!kept && !unsavedSignInWarned.current) {
        unsavedSignInWarned.current = true;
        setError('Sign in to upload your footage. This browser couldn’t save your files for sign-in, so you may need to add them again afterward. Retry to continue to sign-in.');
        return;
      }
      setError(kept ? 'Sign in to upload your footage. Your files will stay here.' : 'Opening sign-in. You may need to add your footage again after you sign in.');
      router.push(`/sign-in?redirect_url=${encodeURIComponent(NEW_PROJECT_PATH)}`);
      return;
    }
    if (!isAuthenticated || !userId) return;
    let job = getProjectImportJob(userId);
    if (!job && cloudIds.length && cloudMedia === undefined) return;
    if (!job && cloudIds.some(id => !cloudMedia?.some(asset => asset._id === id && asset.ownerId === userId && asset.url))) {
      setError('This saved footage is unavailable. Start over and choose another source.');
      setProcessing({ phase: 'error', index: 1, total: files.length + cloudIds.length, percent: 0 });
      return;
    }
    submitting.current = true;
    const epoch = draftEpoch.current;
    setError('');
    try {
      const prompt = brief.current.trim();
      const sourceName = files[0]?.file.name ?? cloudMedia?.[0]?.fileName ?? 'New video';
      const title = (prompt ? prompt.replace(/\s+/g, ' ') : sourceName.replace(/\.[^.]+$/, '')).slice(0, 80) || 'New video';
      job ??= getOrCreateProjectImportJob(userId, session.current, { title, files, assetIds: cloudIds, aspectRatio });
      session.current = job.session;
      const activeJob = job;
      unsubscribe.current?.();
      unsubscribe.current = activeJob.subscribe(() => {
        if (mounted.current) { setProcessing(activeJob.progress); setError(activeJob.error ?? ''); }
      });
      setProcessing(activeJob.progress);
      const projectId = await activeJob.start({
        stage: stashFiles,
        create: (value, assetIds) => createProject({ title: value, aspectRatio: activeJob.input.aspectRatio ?? aspectRatio, ...(assetIds.length ? { assetIds } : {}), ...(activeJob.input.placeOnTimeline === false ? { placeOnTimeline: false } : {}) }),
        project: async projectId => { const project = await convex.query(api.projects.get, { projectId }); if (!project) throw new Error('This project is no longer available. Start a new project to retry.'); return { timeline: project.timeline, revision: project.revision ?? 0 }; },
        upload: (projectId, file, progress) => uploadSourceFile(file, sourceUpload.transport(projectId, file, {
          onThumbnail: image => {
            posters.current.set(file, image);
            if (!mounted.current) return;
            const url = URL.createObjectURL(image); posterUrls.current.add(url);
            const sourceId = activeJob.input.files.find(item => item.file === file)?.id;
            setPreviews(previous => previous.map(item => item.id === sourceId ? {...item, thumbnail: url} : item));
          },
        }), progress),
        asset: (projectId, assetId) => convex.query(api.assets.get, { projectId, assetId }),
        prepare: (projectId, asset, onActivity) => prepareMediaForEditing(convex, projectId, asset._id as Id<'assets'>, onActivity),
        save: async (projectId, timeline, expectedRevision) => (await saveTimeline({ projectId, timeline, expectedRevision })).revision,
        acknowledge: file => acknowledgeDraftFiles([file]),
      });
      if (!mounted.current || draftEpoch.current !== epoch) return;
      try {
        rememberOpeningRequest(projectId, prompt, composerControls.request);
        clearNewProjectSources();
        // The new project holds its own copy of each imported video.
        discardHolders(Object.values(linkHolders));
      } catch { if (prompt) throw new Error('Your footage is saved, but this browser could not preserve your request. Open the editor to continue.'); }
      const first = activeJob.input.files[0]?.file;
      rememberOpeningFootage(projectId, first ? posters.current.get(first) ?? (first.type.startsWith('image/') ? first : undefined) : cloudMedia?.[0]?.thumbnailUrl ?? undefined, first?.name ?? cloudMedia?.[0]?.fileName);
      clearProjectImportJob(activeJob);
      router.push(projectPath(projectId, resultsView));
    } catch (cause) {
      if (mounted.current && draftEpoch.current === epoch) {
        setError(userError(cause, 'Could not prepare your footage. Retry to continue from where it stopped.'));
        setProcessing(previous => ({ ...(previous ?? { index: 1, total: files.length + cloudIds.length, percent: 0 }), phase: 'error' }));
      }
      if (draftEpoch.current === epoch) submitting.current = false;
    }
  }

  useEffect(() => {
    if (!draftReady || !processing || processing.phase === 'error' || !hasMedia) return;
    void processFootage();
  }, [draftReady, files, cloudIds, cloudMedia, isLoaded, isSignedIn, isAuthenticated, authLoading, processing?.phase]);

  function reset() {
    const job = getProjectImportJob(userId ?? undefined);
    if (job) clearProjectImportJob(job);
    unsubscribe.current?.();
    submitting.current = false;
    session.current = createProjectImportSession();
    draftEpoch.current++;
    setFiles([]); setCloudIds([]); setProcessing(null); setError(''); setStartingBlank(false);
    if (linkImport) void cancelLinkImport();
    discardHolders(Object.values(linkHolders)); setLinkHolders({});
    setLinkShelf(shelf => ({ ...shelf, open: false, prefill: '' }));
    brief.current = ''; setDraft(''); setAspectRatio('landscape');
    try { clearNewProjectDraft(); } catch { /* The current selection is cleared in memory. */ }
    void stashFiles([]);
  }
  function changeDraft(value: string) {
    setDraft(value); brief.current = value;
    try { saveNewProjectBrief(value); } catch { /* The draft stays in this page. */ }
  }
  function openLinkShelf(prefill = '') {
    setLinkShelf(shelf => ({ open: true, prefill, focusKey: shelf.focusKey + 1 }));
  }
  function closeLinkShelf() {
    // A pasted link the user dismissed pastes as plain text next time.
    declinedLink.current = linkShelf.prefill;
    setLinkShelf(shelf => ({ ...shelf, open: false, prefill: '' }));
  }
  /** A lone video link pasted into the empty prompt opens the link shelf with it. */
  function pasteLink(text: string) {
    const link = text.trim();
    if (draft || !draftReady || busy || linkImporting || !isVideoLinkOnly(link)) return false;
    if (link === declinedLink.current) { declinedLink.current = ''; return false; }
    openLinkShelf(link);
    return true;
  }
  function keepLinkHolders(holders: Record<string, Id<'projects'>>) {
    setLinkHolders(holders);
    try { saveNewProjectLinkImports(holders); } catch { /* The holders stay in memory. */ }
  }
  function discardHolders(projectIds: Id<'projects'>[]) {
    for (const projectId of projectIds) void removeProject({ projectId }).catch(() => { /* It stays in the project list as "Video import". */ });
  }
  function stopWaitingToSend() {
    setSendAfterImport(false);
    sendWaiter.current?.(); sendWaiter.current = null;
  }
  /** Runs the whole import in place. Resolves once the video is attached; nothing navigates. */
  async function importLink(url: string) {
    setLinkImporting(true);
    try {
      setLinkImport(await importVideo({ url, sourcesOnly: true }));
      await new Promise<void>((resolve, reject) => { linkSettle.current = { resolve, reject }; });
    } finally { linkSettle.current = null; setLinkImporting(false); }
  }
  function endLinkImport(failure?: string) {
    const settle = linkSettle.current;
    setLinkImport(null);
    if (failure) { stopWaitingToSend(); settle?.reject(new Error(failure)); } else settle?.resolve();
  }
  async function cancelLinkImport() {
    if (!linkImport) return;
    const { taskId, projectId } = linkImport;
    stopWaitingToSend(); endLinkImport();
    setLinkShelf(shelf => ({ ...shelf, open: false, prefill: '' }));
    try { await cancelMediaTask({ taskId }); } catch { /* The holder is removed either way. */ }
    discardHolders([projectId]);
  }
  useEffect(() => {
    if (!linkImport || !linkTask || linkTask._id !== linkImport.taskId) return;
    if (linkTask.status === 'completed' && linkTask.assetId) {
      const assetId = linkTask.assetId;
      const attached = cloudIds.includes(assetId) ? cloudIds : [...cloudIds, assetId];
      setCloudIds(attached);
      try { saveNewProjectCloudFootage(attached); } catch { /* The selection stays in memory. */ }
      keepLinkHolders({ ...linkHolders, [assetId]: linkImport.projectId });
      setLinkShelf(shelf => ({ ...shelf, open: false, prefill: '' }));
      endLinkImport();
    } else if (linkTask.status === 'failed' || linkTask.status === 'cancelled') {
      discardHolders([linkImport.projectId]);
      endLinkImport(linkTask.status === 'failed' ? importErrorMessage(linkTask.error) : 'The import was cancelled.');
    }
  }, [linkImport, linkTask?._id, linkTask?.status, linkTask?.assetId]);
  useEffect(() => {
    // Wait for the imported video's details as well, so the edit starts with it.
    if (!sendAfterImport || linkImporting || cloudIds.length && cloudMedia === undefined) return;
    // The send button stays busy until the edit has started or reported its error.
    const done = sendWaiter.current; sendWaiter.current = null;
    setSendAfterImport(false);
    void send().catch(cause => setError(userError(cause, 'Could not start your edit.'))).finally(() => done?.());
  }, [sendAfterImport, linkImporting, cloudIds, cloudMedia]);
  const linkProgress: LinkImportProgress | undefined = !linkImport ? undefined
    : !linkTask || linkTask.status === 'queued' ? { label: 'Queued…' }
    : linkTask.status === 'retrying' ? { label: 'Retrying…' }
    : { label: 'Importing', percent: Math.min(99, Math.round(linkTask.progress)) };
  async function submit() {
    if (!draftReady || !settings || busy || submitting.current) return;
    if (linkImporting) {
      setSendAfterImport(true);
      await new Promise<void>(resolve => { sendWaiter.current = resolve; });
      return;
    }
    await send();
  }
  async function send() {
    if (hasMedia) { await processFootage(); return; }
    const prompt = brief.current.trim();
    if (startingBlank || !prompt) return;
    setStartingBlank(true); setError('');
    try {
      const projectId = await createProject({ title: (prompt.replace(/\s+/g, ' ').slice(0, 80)) || 'New video', aspectRatio });
      rememberOpeningRequest(projectId, prompt, composerControls.request);
      saveNewProjectBrief('');
      router.push(projectPath(projectId, resultsView));
    } catch (cause) { setError(userError(cause, 'Could not create the project.')); setStartingBlank(false); }
  }
  async function openPartialProject() {
    if (!session.current.projectId) return;
    await stashFiles(files.filter(item => !session.current.uploaded.has(item.id)).map(item => item.file));
    try { clearNewProjectDraft(); } catch { /* Opening does not need draft storage. */ }
    const job = getProjectImportJob(userId ?? undefined);
    if (job) clearProjectImportJob(job);
    router.push('/editor/' + session.current.projectId);
  }
  const fileDrop = useMediaFileDrop({ busy, onUpload: async incoming => attach(incoming), onError: setError });
  const dragging = fileDrop.active;
  const status = processing;
  const processingFiles = [...cloudIds.map((id): FootageProcessingFile => {
    const asset = cloudMedia?.find(item => item._id === id);
    return { id, name: asset?.fileName ?? 'Saved footage', kind: asset?.kind ?? 'video', url: asset?.url ?? undefined };
  }), ...previews];

  return <div className={`workspace-page new-conversation${!status ? ' new-conversation-empty' : ''}${showRecentProjects ? ' new-conversation-has-projects' : ''}`} {...fileDrop.handlers}>
    <WorkspaceNav title={NEW_WORKSPACE_LABEL} />
    {status ? <FootageProcessingCard progressKey={session.current.projectId ? `project:${session.current.projectId}` : undefined} files={processingFiles} {...status} error={error} onRetry={() => void processFootage()} onReset={reset} onOpen={session.current.projectId ? () => void openPartialProject() : undefined}/> : <ConversationStart guidance={showRecentProjects ? <section className="new-conversation-recent" aria-labelledby="recent-projects-title">
      <div className="new-conversation-recent-heading"><h2 id="recent-projects-title" className="new-conversation-actions-title">Recent projects</h2><Button type="button" variant="ghost" size="sm" className="new-conversation-upload-new" disabled={!draftReady || busy} onClick={() => picker.current?.click()}><Plus aria-hidden="true"/>Upload new</Button></div>
      <div className="new-conversation-projects" aria-busy={projectsLoading}>{projectsLoading ? Array.from({ length: 6 }, (_, index) => <Button key={index} type="button" variant="ghost" className="new-conversation-project" disabled aria-label="Loading project"><Skeleton as="span" className="workspace-chat-cover"/><span className="new-conversation-project-details"><Skeleton as="span" className="h-3 w-28 bg-[#2a2a2a]"/><Skeleton as="span" className="h-3 w-16 bg-[#2a2a2a]"/></span></Button>) : recentProjects.map(project => <Button key={project.id} asChild variant="ghost" className="new-conversation-project"><Link href={`/editor/${project.id}`}><ProjectCover url={project.coverUrl} kind={project.coverKind}/><span className="new-conversation-project-details"><strong>{project.title}</strong><span>{project.running ? 'Editing…' : chatRecency(project.updatedAt)}</span></span></Link></Button>)}</div>
      {projectsLoading && <span className="sr-only" role="status">Loading recent projects…</span>}
    </section> : <section className="new-conversation-actions" aria-labelledby="new-edit-actions-title">
      <h2 id="new-edit-actions-title" className="new-conversation-actions-title">Start new edit</h2>
      <Button type="button" variant="ghost" className="new-conversation-action" disabled={!draftReady || busy} onClick={() => picker.current?.click()}><Plus aria-hidden="true"/><span>Upload footage</span></Button>
    </section>}>
        <div className="new-conversation-entry" data-dragging={dragging || undefined} aria-busy={busy}>
          <EditComposer footer={<ComposerLinkShelf open={linkShelf.open} prefill={linkShelf.prefill} focusKey={linkShelf.focusKey} disabled={!draftReady || busy} progress={linkProgress} onImport={importLink} onCancel={() => void cancelLinkImport()} onClose={closeLinkShelf}/>} footerOpen={linkShelf.open} onPasteText={pasteLink} slashCommands value={draft} onChange={changeDraft} onSubmit={submit} onAttach={() => picker.current?.click()} attachments={processingFiles} onRemoveAttachment={removeAttachment} actions={<><ResultsControl value={resultsView} onChange={setResultsView} disabled={!draftReady || busy} />{composerControls.actions}</>} disabled={!draftReady || busy} submitDisabled={!settings} attachmentLimit={200} attachControl={<DropdownMenu><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="composer-add" aria-label="Add footage" disabled={!draftReady || busy}><Plus /></Button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>Add footage</TooltipContent></Tooltip><DropdownMenuContent align="start" className="border-[#363636] bg-[#222] text-neutral-200" onCloseAutoFocus={event => {
              // The menu traps focus until it has closed, so the link field takes focus here instead of the + button.
              if (!focusLinkAfterMenu.current) return;
              focusLinkAfterMenu.current = false; event.preventDefault(); setLinkShelf(shelf => ({ ...shelf, focusKey: shelf.focusKey + 1 }));
            }}><DropdownMenuItem onSelect={() => picker.current?.click()}><Upload />Upload files</DropdownMenuItem><DropdownMenuItem onSelect={() => { focusLinkAfterMenu.current = true; openLinkShelf(); }}><Link2 />Paste a link</DropdownMenuItem></DropdownMenuContent></DropdownMenu>} placeholder="Describe your video, or drop footage here"/>
          <input ref={picker} type="file" accept="video/*,audio/*,image/*" multiple className="sr-only" tabIndex={-1} aria-label="Choose media to upload" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) attach(files); }}/>
          {error && <p className="new-conversation-error" role="alert">{error}</p>}
        </div>
    </ConversationStart>}
  </div>;
}
