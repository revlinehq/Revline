'use client';

import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConvexProvider, ConvexReactClient, useConvex, useQuery } from 'convex/react';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { Preview, type PreviewHandle } from '@/components/editor/preview';
import { EditorStateProvider } from '@/components/editor/editor-state';
import { createEditorStore } from '@/lib/editor/store';
import { dimensions, EMPTY_TIMELINE, timelineDuration } from '@/lib/editor/types';
import './player.css';

const command = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('authenticate'), token: z.string().min(1), deploymentURL: z.string().url() }),
  z.object({ kind: z.literal('play') }),
  z.object({ kind: z.literal('pause') }),
  z.object({ kind: z.literal('seek'), time: z.number().finite().nonnegative() }),
  z.object({ kind: z.literal('timeline'), timelineId: z.string().min(1) }),
]);
type PlayerCommand = z.infer<typeof command>;
type NativeEvent = { kind: 'bridgeReady' | 'ready' | 'needsAuth' } | { kind: 'time'; time: number } | { kind: 'playing'; playing: boolean } | { kind: 'error'; message: string };

declare global {
  interface Window {
    revlinePlayer?: { receive: (message: unknown) => void };
    webkit?: { messageHandlers?: { revline?: { postMessage: (message: NativeEvent) => void } } };
  }
}

function notify(event: NativeEvent) { window.webkit?.messageHandlers?.revline?.postMessage(event); }

class PlayerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { notify({ kind: 'error', message: 'The preview could not load. Retry from the app.' }); }
  render() { return this.state.failed ? <p role="status">Preview unavailable</p> : this.props.children; }
}

/** The shell is public; every project, media, and draft read requires a verified Convex JWT. */
export function MobilePlayer({ projectId }: { projectId: string }) {
  const [client, setClient] = useState<ConvexReactClient | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [timelineId, setTimelineId] = useState<string>();
  const controls = useRef<PreviewHandle>(null);
  useEffect(() => {
    const client = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    setClient(client);
    window.revlinePlayer = { receive: input => {
      const parsed = command.safeParse(input);
      if (!parsed.success) return;
      const value: PlayerCommand = parsed.data;
      switch (value.kind) {
        case 'authenticate':
          if (value.deploymentURL !== process.env.NEXT_PUBLIC_CONVEX_URL) {
            notify({ kind: 'error', message: 'The app and player are using different environments.' });
            return;
          }
          client.setAuth(async () => value.token, accepted => {
            setAuthenticated(accepted);
            if (!accepted) notify({ kind: 'needsAuth' });
          });
          break;
        case 'play': controls.current?.play(); break;
        case 'pause': controls.current?.pause(); break;
        case 'seek': controls.current?.seek(value.time); break;
        case 'timeline': setTimelineId(value.timelineId); break;
      }
    } };
    notify({ kind: 'bridgeReady' });
    // Native replaces short-lived tokens in memory. No tokens enter URLs, cookies, or storage.
    const refresh = setInterval(() => notify({ kind: 'needsAuth' }), 40_000);
    return () => { clearInterval(refresh); delete window.revlinePlayer; void client.close(); };
  }, []);
  return <main className="mobile-player-shell dark">{client && <ConvexProvider client={client}>
    <PlayerBoundary>{authenticated && <AuthenticatedPlayer projectId={projectId} timelineId={timelineId} controls={controls} />}</PlayerBoundary>
  </ConvexProvider>}</main>;
}

function AuthenticatedPlayer({ projectId, timelineId, controls }: { projectId: string; timelineId?: string; controls: React.RefObject<PreviewHandle | null> }) {
  const project = useQuery(api.projects.get, { projectId, includeHistory: false });
  useEffect(()=>{if(project===null){controls.current?.pause();notify({kind:'error',message:'This project is no longer available.'});}},[project,controls]);
  if(!project)return <p role="status">{project===null?'This project is no longer available.':'Loading preview…'}</p>;
  return <AvailablePlayer key={projectId} project={project} timelineId={timelineId} controls={controls}/>;
}
function AvailablePlayer({ project, timelineId, controls }: { project:Doc<'projects'>; timelineId?: string; controls: React.RefObject<PreviewHandle | null> }) {
  const projectId=project._id,convex=useConvex();
  const assets = useQuery(api.assets.list, { projectId, limit: 200 });
  const status = useQuery(api.assistant.status, { projectId });
  const draft = useQuery(api.assistant.livePreview, status?.running ? { projectId } : 'skip');
  const snapshots = useQuery(api.timelineTabs.snapshots, { projectId });
  const [store] = useState(() => createEditorStore(EMPTY_TIMELINE));
  const [time, setTime] = useState(0);
  const reportedAt = useRef(0);
  const [container, setContainer] = useState({ width: 1, height: 1 });
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setContainer({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const activeId = project?.activeTimelineId ?? 'main';
  const timeline = timelineId && timelineId !== activeId ? snapshots?.find(item => item.id === timelineId)?.timeline : draft?.timeline ?? project?.timeline;
  const projectCanvas = dimensions(timeline?.aspectRatio ?? 'vertical');
  const scale = Math.min(container.width / projectCanvas.width, container.height / projectCanvas.height);
  useEffect(() => {
    controls.current?.pause();
    controls.current?.seek(0);
    setTime(0);
  }, [timelineId, controls]);
  return <div ref={host} className="mobile-player-container">
    {project && assets && timeline && timeline.clips.length > 0 ? <EditorStateProvider store={store}>
      <div className="mobile-player-frame" style={{ width: projectCanvas.width * scale, height: projectCanvas.height * scale }}>
        <Preview ref={controls} timeline={timeline} assets={assets} time={time} muted={false} debugId={projectId}
          onTime={value => {
            const now = performance.now();
            if (store.getState().playing && now - reportedAt.current < 100) return;
            reportedAt.current = now;
            setTime(value); store.setState({ playhead: value }); notify({ kind: 'time', time: value });
          }}
          onPlaying={playing => { store.setState({ playing }); notify({ kind: 'playing', playing }); }}
          onReady={() => notify({ kind: 'ready' })}
          onError={message => notify({ kind: 'error', message })}
          onRefreshMedia={async () => convex.query(api.assets.list, { projectId: project._id, limit: 200 })} />
      </div>
    </EditorStateProvider> : <p role="status">{project && timelineDuration(timeline ?? EMPTY_TIMELINE) === 0 ? 'Your preview starts here' : 'Loading preview…'}</p>}
  </div>;
}
