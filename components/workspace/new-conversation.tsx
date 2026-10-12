'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useClerk } from '@clerk/nextjs';
import { useAction, useConvex, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { createProjectImportSession, type ImportFile, type ProjectImportProgress } from '@/lib/editor/project-import';
import { clearProjectImportJob, getOrCreateProjectImportJob, getProjectImportJob } from '@/lib/editor/project-import-job';
import { uploadSourceFile } from '@/lib/editor/upload-source';
import { prepareVideoAudio, prepareAudioWaveform } from '@/lib/editor/prepare-video-audio';
import { FootageStartCard } from './footage-start-card';
import { FootageProcessingCard, type FootageProcessingFile, type FootageProcessingPhase } from './footage-processing-card';
import { RecentProjects } from './recent-projects';
import { WorkspaceNav } from './workspace-nav';
import { acknowledgeDraftFiles, stashFiles, takeFiles } from './project-draft';
import './shared.css';
import './new-conversation.css';

const briefKey = 'revline:next-brief';
const cloudKey = 'revline:next-cloud-footage';
type Processing = Omit<ProjectImportProgress, 'phase'> & { phase: FootageProcessingPhase };

export function NewConversation() {
  const router = useRouter();
  const clerk = useClerk();
  const convex = useConvex();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const createProject = useMutation(api.projects.create);
  const saveTimeline = useMutation(api.projects.saveTimeline);
  const startUpload = useAction(api.r2.start);
  const partUrl = useAction(api.r2.partUrl);
  const finishUpload = useAction(api.r2.complete);
  const abortUpload = useAction(api.r2.abort);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const unsubscribe = useRef<(() => void) | null>(null);
  const dragDepth = useRef(0);
  const restore = useRef<Promise<File[]> | null>(null);
  const session = useRef(createProjectImportSession());
  const brief = useRef('');
  const [draftReady, setDraftReady] = useState(false);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [previews, setPreviews] = useState<FootageProcessingFile[]>([]);
  const [cloudIds, setCloudIds] = useState<Id<'assets'>[]>([]);
  const cloudMedia = useQuery(api.assets.selected, isAuthenticated && cloudIds.length ? { assetIds: cloudIds } : 'skip');
  const [processing, setProcessing] = useState<Processing | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const hasMedia = files.length + cloudIds.length > 0;
  const busy = processing?.phase !== 'error' && (processing !== null || hasMedia);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; unsubscribe.current?.(); }; }, []);

  useEffect(() => {
    if (!isLoaded) return;
    try { brief.current = sessionStorage.getItem(briefKey) ?? ''; } catch { /* Uploads can still start in this page. */ }
    const job = getProjectImportJob(userId ?? undefined);
    if (job) {
      session.current = job.session;
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
    restore.current ??= takeFiles();
    void restore.current.then(async pending => {
      if (!active) return;
      if (pending.length) {
        setFiles(pending.map(file => ({ id: crypto.randomUUID(), file })));
        await stashFiles(pending);
      }
      setDraftReady(true);
    }).catch(() => { if (active) { setError('Could not restore your footage. Please add it again.'); setDraftReady(true); } });
    return () => { active = false; };
  }, [isLoaded, userId]);

  useEffect(() => {
    const items = files.map(({ id, file }): FootageProcessingFile => ({ id, name: file.name, kind: file.type.split('/')[0] as FootageProcessingFile['kind'], url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined }));
    setPreviews(items);
    return () => { for (const item of items) if (item.url) URL.revokeObjectURL(item.url); };
  }, [files]);

  function attach(incoming: File[]) {
    if (busy || !draftReady || submitting.current) return;
    const accepted = incoming.filter(file => /^(video|audio|image)\//.test(file.type) && file.size > 0);
    if (!accepted.length) { setError('Choose a nonempty video, audio, or image file.'); return; }
    const unique = accepted.filter((file, index) => accepted.findIndex(other => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified) === index);
    if (unique.length > 200) { setError('Choose up to 200 media files for this edit.'); return; }
    const previousJob = getProjectImportJob(userId ?? undefined);
    if (previousJob) clearProjectImportJob(previousJob);
    session.current = createProjectImportSession();
    setCloudIds([]);
    setFiles(unique.map(file => ({ id: crypto.randomUUID(), file })));
    setError(accepted.length !== incoming.length ? 'Unsupported or empty files were skipped.' : '');
    setProcessing({ phase: 'connecting', index: 1, total: unique.length, percent: 0 });
    void stashFiles(unique);
  }

  async function processFootage() {
    if (submitting.current || !hasMedia || !isLoaded || authLoading) return;
    if (!isSignedIn) {
      setError('Sign in to upload your footage. Your files will stay here.');
      setProcessing({ phase: 'error', index: 1, total: files.length + cloudIds.length, percent: 0 });
      clerk.openSignIn({ fallbackRedirectUrl: '/chat', signUpFallbackRedirectUrl: '/chat' });
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
    setError('');
    try {
      const prompt = brief.current.trim();
      const sourceName = files[0]?.file.name ?? cloudMedia?.[0]?.fileName ?? 'New video';
      const title = (prompt ? prompt.replace(/\s+/g, ' ') : sourceName.replace(/\.[^.]+$/, '')).slice(0, 80) || 'New video';
      job ??= getOrCreateProjectImportJob(userId, session.current, { title, files, assetIds: cloudIds });
      session.current = job.session;
      const activeJob = job;
      unsubscribe.current?.();
      unsubscribe.current = activeJob.subscribe(() => {
        if (mounted.current) { setProcessing(activeJob.progress); setError(activeJob.error ?? ''); }
      });
      setProcessing(activeJob.progress);
      const projectId = await activeJob.start({
        stage: stashFiles,
        create: (value, assetIds) => createProject({ title: value, aspectRatio: 'vertical', ...(assetIds.length ? { assetIds } : {}) }),
        project: async projectId => { const project = await convex.query(api.projects.get, { projectId }); return { timeline: project.timeline, revision: project.revision ?? 0 }; },
        upload: (projectId, file, progress) => uploadSourceFile(file, {
          start: metadata => startUpload({ projectId, fileName: file.name, contentType: file.type, size: file.size, ...metadata }),
          partUrl: (uploadId, partNumber) => partUrl({ uploadId, partNumber }),
          complete: (uploadId, parts) => finishUpload({ uploadId, parts }),
          abort: uploadId => abortUpload({ uploadId }),
        }, progress),
        asset: async (projectId, assetId) => {
          const asset = await convex.query(api.assets.get, { projectId, assetId });
          if (asset.kind === 'video' && !asset.audioExtracted) {
            await prepareVideoAudio(convex,projectId, assetId);
            return convex.query(api.assets.get, { projectId, assetId });
          }
          if (asset.kind === 'audio' && !asset.waveform) {
            await prepareAudioWaveform(convex,projectId, assetId);
            return convex.query(api.assets.get, { projectId, assetId });
          }
          return asset;
        },
        save: async (projectId, timeline, expectedRevision) => (await saveTimeline({ projectId, timeline, expectedRevision })).revision,
        acknowledge: file => acknowledgeDraftFiles([file]),
      });
      if (!mounted.current) return;
      try {
        if (prompt) sessionStorage.setItem('revline:brief:' + projectId, prompt);
        sessionStorage.removeItem(briefKey);
        sessionStorage.removeItem(cloudKey);
      } catch { if (prompt) throw new Error('Your footage is saved, but this browser could not preserve your request. Open the editor to continue.'); }
      clearProjectImportJob(activeJob);
      router.push('/editor/' + projectId);
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Could not prepare your footage. Retry to continue from where it stopped.');
        setProcessing(previous => ({ ...(previous ?? { index: 1, total: files.length + cloudIds.length, percent: 0 }), phase: 'error' }));
      }
      submitting.current = false;
    }
  }

  useEffect(() => {
    if (!draftReady || processing?.phase === 'error' || !hasMedia) return;
    void processFootage();
  }, [draftReady, files, cloudIds, cloudMedia, isLoaded, isSignedIn, isAuthenticated, authLoading]);

  function reset() {
    const job = getProjectImportJob(userId ?? undefined);
    if (job) clearProjectImportJob(job);
    unsubscribe.current?.();
    session.current = createProjectImportSession();
    setFiles([]); setCloudIds([]); setProcessing(null); setError('');
    brief.current = '';
    try { sessionStorage.removeItem(briefKey); sessionStorage.removeItem(cloudKey); } catch { /* The current selection is cleared in memory. */ }
    void stashFiles([]);
  }
  async function openPartialProject() {
    if (!session.current.projectId) return;
    await stashFiles(files.filter(item => !session.current.uploaded.has(item.id)).map(item => item.file));
    try { sessionStorage.removeItem(briefKey); sessionStorage.removeItem(cloudKey); } catch { /* Opening does not need draft storage. */ }
    const job = getProjectImportJob(userId ?? undefined);
    if (job) clearProjectImportJob(job);
    router.push('/editor/' + session.current.projectId);
  }
  function fileDrag(event: DragEvent) { return event.dataTransfer.types.includes('Files'); }
  const status = processing ?? (hasMedia ? { phase: 'connecting' as const, index: 1, total: files.length + cloudIds.length, percent: 0 } : null);
  const processingFiles = [...cloudIds.map((id): FootageProcessingFile => {
    const asset = cloudMedia?.find(item => item._id === id);
    return { id, name: asset?.fileName ?? 'Saved footage', kind: asset?.kind ?? 'video', url: asset?.url ?? undefined };
  }), ...previews];

  return <div className="workspace-page new-conversation" onDragEnter={event => {
    if (!fileDrag(event)) return;
    event.preventDefault(); dragDepth.current++; setDragging(true);
  }} onDragOver={event => { if (fileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }} onDragLeave={event => {
    if (!fileDrag(event)) return;
    event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false);
  }} onDrop={event => {
    if (!fileDrag(event)) return;
    event.preventDefault(); dragDepth.current = 0; setDragging(false); attach(Array.from(event.dataTransfer.files));
  }}>
    <WorkspaceNav title="New chat" />
    <main className="new-conversation-main" aria-labelledby="new-conversation-title">
      <div className="new-conversation-start">
        <div className="new-conversation-intro"><h1 id="new-conversation-title">AI VIDEO EDITING</h1><p>Add your clips, then tell Revline what to make.</p></div>
        <div className="new-conversation-entry" data-dragging={dragging || undefined} aria-busy={busy}>
          {status ? <FootageProcessingCard files={processingFiles} {...status} error={error} onRetry={() => void processFootage()} onReset={reset} onOpen={session.current.projectId ? () => void openPartialProject() : undefined} /> : <FootageStartCard onAttach={() => input.current?.click()} disabled={!draftReady} dragging={dragging} />}
          {error && status?.phase !== 'error' && <p className="new-conversation-error" role="alert">{error}</p>}
        </div>
      </div>
      {!status && <RecentProjects />}
      <input ref={input} type="file" accept="video/*,audio/*,image/*" multiple className="sr-only" tabIndex={-1} aria-label="Choose footage" onChange={event => { attach(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    </main>
    {dragging && <div className="new-conversation-drop-note" role="status">{busy ? 'Your footage is processing…' : 'Drop your footage to start editing'}</div>}
  </div>;
}
