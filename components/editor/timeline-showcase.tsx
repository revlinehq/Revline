'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import { userError } from '@/lib/user-error';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { ArrowUpRight, Film, LoaderCircle, RectangleHorizontal } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { createEditorStore } from '@/lib/editor/store';
import { frameSeekTime } from '@/lib/editor/operations';
import { dimensions, timelineDuration, type MediaAsset, type Timeline } from '@/lib/editor/types';
import { Brand } from '@/components/workspace/brand';
import { PrimaryButton } from '@/components/workspace/primary-button';
import { EditorStateProvider, useEditorState, useEditorStore, usePausedPlaybackTime } from './editor-state';
import { Preview, type PreviewHandle } from './preview';
import { PreviewViewport, PreviewZoomControls, PreviewZoomProvider } from './preview-zoom';
import { PlaybackControls } from './playback-controls';
import { TimelinePanel } from './timeline';
import { timelineShareCover, timelineSharePath } from './timeline-share-dialog';
import './timeline-sharing.css';

export type SharedTimeline = { _id: string; title: string; updatedAt: number; timeline: Timeline; assets: MediaAsset[] };
const noEdit = () => {};
export function timelineSignInPath(shareId: string) { return `/sign-in?redirect_url=${encodeURIComponent(timelineSharePath(shareId))}`; }

export function TimelineShowcase({ shareId }: { shareId: string }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth(), { isAuthenticated } = useConvexAuth();
  const share = useQuery(api.timelineShares.get, { shareId });
  const copy = useMutation(api.timelineShares.useTimeline);
  if (share === undefined) return <div className="timeline-showcase"><ShowcaseHeader/><div className="timeline-showcase-loading" role="status"><LoaderCircle size={22} className="animate-spin"/><span>Loading timeline…</span></div></div>;
  if (!share) return <div className="timeline-showcase"><ShowcaseHeader/><div className="timeline-showcase-unavailable"><h1>This timeline isn’t available</h1><p>The link may have been turned off or the original project removed.</p><PrimaryButton asChild><Link href={NEW_PROJECT_PATH}>Open Revline<ArrowUpRight size={14}/></Link></PrimaryButton></div></div>;
  return <TimelineShowcaseView key={`${share._id}:${share.updatedAt}`} share={share} signedIn={!!isSignedIn} useDisabled={!isLoaded || (!!isSignedIn && !isAuthenticated)} onUse={async () => {
    if (!isSignedIn) { router.push(timelineSignInPath(share._id)); return; }
    const projectId = await copy({ shareId: share._id });
    router.push(`/editor/${projectId}`);
  }}/>;
}

function ShowcaseHeader({ title = 'Shared timeline', copying = false }: { title?: string; copying?: boolean }) {
  return <header className="timeline-showcase-header"><Link href="/" aria-label="Revline home"><Brand/></Link><span>{title}</span><small>{copying ? 'Creating copy…' : 'Showcase'}</small></header>;
}

export function TimelineShowcaseView(props: { share: SharedTimeline; signedIn: boolean; useDisabled?: boolean; onUse: () => Promise<void> }) {
  const [store] = useState(() => createEditorStore(props.share.timeline));
  return <EditorStateProvider store={store}><ShowcaseContent {...props}/></EditorStateProvider>;
}

function ShowcaseContent({ share, signedIn, useDisabled, onUse }: Parameters<typeof TimelineShowcaseView>[0]) {
  const { timeline, assets, title } = share;
  const store = useEditorStore(), time = usePausedPlaybackTime();
  const playing = useEditorState(state => state.playing), muted = useEditorState(state => state.muted), selected = useEditorState(state => state.selectedId);
  const preview = useRef<PreviewHandle>(null), inFlight = useRef(false);
  const [copying, setCopying] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState(''), [previewError, setPreviewError] = useState('');
  const duration = timelineDuration(timeline), canvas = dimensions(timeline.aspectRatio), cover = timelineShareCover(timeline, assets);
  const readTime = () => preview.current?.currentTime() ?? store.getState().playhead;
  function seek(at: number) { preview.current?.pause(); store.setState({ playing: false, playhead: frameSeekTime(at, timeline.fps, duration) }); preview.current?.seek(store.getState().playhead); }
  function togglePlay() { if (!ready) return; if (store.getState().playing) preview.current?.pause(); else preview.current?.play(); }
  function cut(direction: -1 | 1) {
    const at = readTime(), cuts = [...new Set([0, ...timeline.clips.map(clip => clip.start), duration])].sort((a, b) => a - b);
    seek(direction === -1 ? cuts.findLast(cut => cut < at - .01) ?? 0 : cuts.find(cut => cut > at + .01) ?? duration);
  }
  async function useTimeline() {
    if (inFlight.current || useDisabled) return;
    inFlight.current = true; setError('');
    if (signedIn) { preview.current?.pause(); store.setState({ playing: false }); setReady(false); setCopying(true); }
    try { await onUse(); }
    catch (error) { setError(userError(error, 'Could not create your copy. Please try again.')); setCopying(false); }
    finally { inFlight.current = false; }
  }
  return <main className="timeline-showcase conversation-editor editor-app" tabIndex={-1} onKeyDown={event => {
    if (event.defaultPrevented || (event.target as HTMLElement).closest('input,textarea,button,a,select')) return;
    if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); seek(readTime() + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1) / timeline.fps); }
  }}><ShowcaseHeader title={title} copying={copying}/>
    {copying ? <div className="timeline-copy-loading"><div className="timeline-copy-content"><div className="timeline-copy-thumbnail">{cover ? <img src={cover} alt=""/> : <Film size={36} strokeWidth={1.2}/>}</div><div className="timeline-copy-status" role="status"><div><Brand markOnly/><span>Creating your copy…</span></div><p>Adding the timeline and footage to your workspace.</p><small>Preparing your editable timeline</small></div></div></div> : <div className="timeline-showcase-layout">
      <aside className="timeline-showcase-intro"><small>EDITED WITH REVLINE</small><h1>{title}</h1><p className="timeline-showcase-lead">Explore the timeline.<br/>Make it yours.</p><p className="timeline-showcase-description">Start with the same cuts, captions, effects, and showcase footage in your own copy.</p><PrimaryButton onClick={() => void useTimeline()} disabled={useDisabled}>Use timeline<ArrowUpRight size={14}/></PrimaryButton><p className="timeline-showcase-note">Changes are saved to your workspace.</p>{error && <p className="timeline-sharing-error" role="alert">{error}</p>}</aside>
      <div className="timeline-showcase-editor"><PreviewZoomProvider canvas={canvas}><section className="timeline-showcase-preview" aria-label="Shared video preview"><div className="canvas-toolbar"><span className="timeline-showcase-dimensions"><RectangleHorizontal size={14}/>{canvas.width} × {canvas.height}</span><PreviewZoomControls/></div><div className="stage-center"><PreviewViewport><Preview ref={preview} timeline={timeline} assets={assets} time={time} onTime={playhead => store.setState({ playhead })} onPlaying={playing => store.setState({ playing })} onError={setPreviewError} muted={muted} onReady={() => { setReady(true); setPreviewError(''); }}/></PreviewViewport></div><fieldset className="timeline-showcase-playback" disabled={!ready}><PlaybackControls playing={playing} time={time} readTime={readTime} duration={duration} fps={timeline.fps} onTogglePlay={togglePlay} onPrevious={() => cut(-1)} onNext={() => cut(1)}/></fieldset>{previewError && <div className="timeline-showcase-preview-error" role="alert"><p>{previewError}</p><button type="button" onClick={() => { setPreviewError(''); setReady(false); preview.current?.retry(); }}>Try again</button></div>}</section></PreviewZoomProvider>
        <TimelinePanel readOnly timeline={timeline} assets={assets} selected={selected} onSelect={id => store.setState({ selectedId: id, selectedIds: id ? [id] : [] })} time={time} playing={playing} readPlaybackTime={readTime} onSeek={seek} onChange={noEdit} onSplit={noEdit} onDelete={noEdit} onDuplicate={noEdit} onAddText={noEdit} muted={muted} onToggleMute={() => store.setState({ muted: !muted })} onError={setPreviewError}/>
      </div>
    </div>}
  </main>;
}
