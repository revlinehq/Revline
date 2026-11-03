'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import { userError } from '@/lib/user-error';

import { NEW_WORKSPACE_LABEL } from '@/lib/editor/workspace-labels';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useAction, useConvex, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { AspectRatio } from '@/lib/editor/types';
import { createProjectImportSession, type ImportFile, type ProjectImportProgress } from '@/lib/editor/project-import';
import { clearProjectImportJob, getOrCreateProjectImportJob, getProjectImportJob } from '@/lib/editor/project-import-job';
import { uploadSourceFile } from '@/lib/editor/upload-source';
import { uploadMediaThumbnail } from '@/lib/editor/upload-thumbnail';
import { prepareMediaForEditing } from '@/lib/editor/prepare-media-for-editing';
import { useMediaFileDrop } from '@/components/editor/media-file-drop';
import { rememberOpeningFootage } from '@/lib/editor/footage-opening';
import { rememberOpeningRequest } from '@/lib/editor/opening-request';
import { useAssistantComposerControls } from '@/components/editor/assistant-composer-controls';
import { Plus, Upload, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VideoLinkImport } from '@/components/editor/video-link-import';
import { normalizeMediaFile } from '@/lib/editor/media-file';
import { AspectRatioControl } from '@/components/editor/aspect-ratio-control';
import { EditComposer } from './edit-composer';
import { FootageProcessingCard, type FootageProcessingFile, type FootageProcessingPhase } from './footage-processing-card';
import { RecentProjects } from './recent-projects';
import { WorkspaceNav } from './workspace-nav';
import { acknowledgeDraftFiles, prepareExternalAuthRedirect, stashFiles, takeFiles } from './project-draft';
import { NEW_WORKSPACE_EVENT } from './start-new-workspace';
import './shared.css';
import './new-conversation.css';

const briefKey = 'revline:next-brief';
const ratioKey = 'revline:next-aspect-ratio';
const cloudKey = 'revline:next-cloud-footage';
type Processing = Omit<ProjectImportProgress, 'phase'> & { phase: FootageProcessingPhase };

export function NewConversation() {
  const router = useRouter();
  const convex = useConvex();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const picker=useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const importVideo = useMutation(api.mediaTasks.importVideo);
  const createProject = useMutation(api.projects.create);
  const saveTimeline = useMutation(api.projects.saveTimeline);
  const startUpload = useAction(api.r2.start);
  const partUrl = useAction(api.r2.partUrl);
  const finishUpload = useAction(api.r2.complete);
  const abortUpload = useAction(api.r2.abort);
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
  const thumbnailUpload = useMutation(api.assets.generateUploadUrl);
  const attachThumbnail = useMutation(api.assets.attachThumbnail);
  const [previews, setPreviews] = useState<FootageProcessingFile[]>([]);
  const [cloudIds, setCloudIds] = useState<Id<'assets'>[]>([]);
  const cloudMedia = useQuery(api.assets.selected, isAuthenticated && cloudIds.length ? { assetIds: cloudIds } : 'skip');
  const [processing, setProcessing] = useState<Processing | null>(null);
  const [error, setError] = useState('');
  const [startingBlank, setStartingBlank] = useState(false);
  const [draft, setDraft] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('landscape');
  const hasMedia = files.length + cloudIds.length > 0;
  const headline = 'What are we making today?';
  const busy = startingBlank || processing !== null && processing.phase !== 'error';
  const settings = useQuery(api.assistant.composerSettings, isAuthenticated ? {} : 'skip');
  const composerControls = useAssistantComposerControls({ settings: settings ?? {}, draftKey: userId ? `revline:next-composer:${userId}` : undefined, disabled: !draftReady || busy || !settings });

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; unsubscribe.current?.(); }; }, []);
  useEffect(() => {
    const fresh = () => { reset(); setDraftReady(true); };
    window.addEventListener(NEW_WORKSPACE_EVENT, fresh);
    return () => window.removeEventListener(NEW_WORKSPACE_EVENT, fresh);
  }, [userId]);

  useEffect(() => {
    if (!isLoaded) return;
    try { brief.current = sessionStorage.getItem(briefKey) ?? ''; } catch { /* Uploads can still start in this page. */ }
    setDraft(brief.current);
    try {
      const saved = sessionStorage.getItem(ratioKey);
      if (saved === 'landscape' || saved === 'vertical' || saved === 'square' || saved === 'portrait-feed' || saved === 'classic') setAspectRatio(saved);
    } catch { /* Format selection also works without draft storage. */ }
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
      const saved: unknown = JSON.parse(sessionStorage.getItem(cloudKey) ?? '[]');
      if (Array.isArray(saved) && saved.length <= 200 && saved.every(id => typeof id === 'string' && /^[a-z0-9]{32}$/.test(id))) setCloudIds(saved);
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
    try { if (remainingCloud.length) sessionStorage.setItem(cloudKey, JSON.stringify(remainingCloud)); else sessionStorage.removeItem(cloudKey); } catch { /* The selection stays in memory. */ }
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
      job ??= getOrCreateProjectImportJob(userId, session.current, { title, files, assetIds: cloudIds, aspectRatio, placeOnTimeline: !/\b(recreat|remake|reference|clone|copy this|like this)/i.test(prompt) });
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
        upload: (projectId, file, progress) => uploadSourceFile(file, {
          start: metadata => startUpload({ projectId, fileName: file.name, contentType: file.type, size: file.size, ...metadata }),
          partUrl: (uploadId, partNumber) => partUrl({ uploadId, partNumber }),
          complete: (uploadId, parts) => finishUpload({ uploadId, parts }),
          abort: uploadId => abortUpload({ uploadId }),
          onThumbnail: image => {
            posters.current.set(file, image);
            if (!mounted.current) return;
            const url = URL.createObjectURL(image); posterUrls.current.add(url);
            const sourceId = activeJob.input.files.find(item => item.file === file)?.id;
            setPreviews(previous => previous.map(item => item.id === sourceId ? {...item, thumbnail: url} : item));
          },
          saveThumbnail: (assetId, image) => uploadMediaThumbnail(image, {
            uploadUrl: () => thumbnailUpload({ projectId }), attach: storageId => attachThumbnail({ assetId, storageId }),
          }),
        }, progress),
        asset: (projectId, assetId) => convex.query(api.assets.get, { projectId, assetId }),
        prepare: (projectId, asset, onActivity) => prepareMediaForEditing(convex, projectId, asset._id as Id<'assets'>, onActivity),
        save: async (projectId, timeline, expectedRevision) => (await saveTimeline({ projectId, timeline, expectedRevision })).revision,
        acknowledge: file => acknowledgeDraftFiles([file]),
      });
      if (!mounted.current || draftEpoch.current !== epoch) return;
      try {
        rememberOpeningRequest(projectId, prompt, composerControls.request);
        if (activeJob.input.placeOnTimeline === false) sessionStorage.setItem('revline:brief-reference:' + projectId, '1');
        sessionStorage.removeItem(briefKey);
        sessionStorage.removeItem(cloudKey);
      } catch { if (prompt) throw new Error('Your footage is saved, but this browser could not preserve your request. Open the editor to continue.'); }
      const first = activeJob.input.files[0]?.file;
      rememberOpeningFootage(projectId, first ? posters.current.get(first) ?? (first.type.startsWith('image/') ? first : undefined) : cloudMedia?.[0]?.thumbnailUrl ?? undefined, first?.name ?? cloudMedia?.[0]?.fileName);
      clearProjectImportJob(activeJob);
      router.push('/editor/' + projectId);
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
    brief.current = ''; setDraft(''); setAspectRatio('landscape');
    try { sessionStorage.removeItem(briefKey); sessionStorage.removeItem(cloudKey); sessionStorage.removeItem(ratioKey); } catch { /* The current selection is cleared in memory. */ }
    void stashFiles([]);
  }
  function changeAspectRatio(value: AspectRatio) {
    setAspectRatio(value);
    try { sessionStorage.setItem(ratioKey, value); } catch { /* Keep the selection in memory. */ }
  }
  function changeDraft(value: string) {
    setDraft(value); brief.current = value;
    try { if (value) sessionStorage.setItem(briefKey, value); else sessionStorage.removeItem(briefKey); } catch { /* The draft stays in this page. */ }
  }
  async function submit() {
    if (!draftReady || !settings || busy || submitting.current) return;
    if (hasMedia) { await processFootage(); return; }
    const prompt = brief.current.trim();
    if (startingBlank || !prompt) return;
    setStartingBlank(true); setError('');
    try {
      const projectId = await createProject({ title: (prompt.replace(/\s+/g, ' ').slice(0, 80)) || 'New video', aspectRatio });
      rememberOpeningRequest(projectId, prompt, composerControls.request);
      sessionStorage.removeItem(briefKey);
      router.push('/editor/' + projectId);
    } catch (cause) { setError(userError(cause, 'Could not create the project.')); setStartingBlank(false); }
  }
  async function openPartialProject() {
    if (!session.current.projectId) return;
    await stashFiles(files.filter(item => !session.current.uploaded.has(item.id)).map(item => item.file));
    try { sessionStorage.removeItem(briefKey); sessionStorage.removeItem(cloudKey); sessionStorage.removeItem(ratioKey); } catch { /* Opening does not need draft storage. */ }
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

  return <div className={`workspace-page new-conversation${!status ? ' new-conversation-empty' : ''}`} {...fileDrop.handlers}>
    <WorkspaceNav title={NEW_WORKSPACE_LABEL} />
    {status ? <FootageProcessingCard files={processingFiles} {...status} error={error} onRetry={() => void processFootage()} onReset={reset} onOpen={session.current.projectId ? () => void openPartialProject() : undefined}/> : <main className="new-conversation-main" aria-labelledby="new-conversation-title">
      <div className="new-conversation-start">
        <div className="new-conversation-compose-group">
        <div className="new-conversation-intro"><h1 id="new-conversation-title" title={headline}>{headline}</h1></div>
        <div className="new-conversation-entry" data-dragging={dragging || undefined} aria-busy={busy}>
          <EditComposer header={<AspectRatioControl appearance="composer" value={aspectRatio} onChange={changeAspectRatio} disabled={!draftReady || busy}/>} slashCommands value={draft} onChange={changeDraft} onSubmit={submit} onAttach={() => picker.current?.click()} attachments={processingFiles} onRemoveAttachment={removeAttachment} actions={composerControls.actions} disabled={!draftReady || busy || !settings} attachmentLimit={200} attachControl={<DropdownMenu><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="composer-add" aria-label="Add footage" disabled={!draftReady || busy}><Plus /></Button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>Add footage</TooltipContent></Tooltip><DropdownMenuContent align="start" className="border-[#363636] bg-[#222] text-neutral-200"><DropdownMenuItem onSelect={() => picker.current?.click()}><Upload />Upload files</DropdownMenuItem><DropdownMenuItem onSelect={() => setLinkOpen(true)}><Link2 />Paste a link</DropdownMenuItem></DropdownMenuContent></DropdownMenu>} placeholder="Describe your video, or drop footage here"/>
          <input ref={picker} type="file" accept="video/*,audio/*,image/*" multiple className="sr-only" tabIndex={-1} aria-label="Choose media to upload" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) attach(files); }}/>
          {error && <p className="new-conversation-error" role="alert">{error}</p>}
        </div>
        <div className="new-conversation-guidance">
          <RecentProjects/>
        </div>
        </div>
      </div>
    </main>}
    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent className="border-[#363636] bg-[#222] text-neutral-100"><DialogTitle>Paste a link</DialogTitle><DialogDescription>Import footage from YouTube or a video URL.</DialogDescription><VideoLinkImport disabled={busy} onImport={async url => {
      const projectId = await createProject({ title: brief.current.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Video import', aspectRatio });
      await importVideo({ url, projectId });
      rememberOpeningRequest(projectId, brief.current.trim(), composerControls.request);
      await stashFiles(files.map(item => item.file));
      setLinkOpen(false);
      router.push('/editor/' + projectId);
    }} /></DialogContent></Dialog>
  </div>;
}
