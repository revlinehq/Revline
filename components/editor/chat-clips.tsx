'use client';
// The finished clips, shown in the chat: one vertical card per timeline tab, with its length and hook line.
// A card plays through the editor's own live preview (the same compositor the editor uses), so nothing is
// exported to watch a clip here. Exporting and posting stay explicit actions under the cards.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Download, Ellipsis, Film, Maximize2, Minimize2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { dimensions, timelineDuration, type MediaAsset, type Timeline } from '@/lib/editor/types';
import { timelineCover } from '@/lib/editor/timeline-cover';
import { hookText } from '@/lib/editor/quick-controls';
import type { RefreshPlaybackMedia } from '@/lib/editor/media-source-recovery';
import { useEditorStore, useEditorState } from './editor-state';
import { Preview, type PreviewHandle } from './preview';
import { PreviewZoomProvider, PreviewViewport } from './preview-zoom';
import './chat-clips.css';

/** A clip's length as on a video card: 0:20. */
const clipLength = (seconds: number) => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;

export type ChatClip = { id: string; name: string; timeline: Timeline };

function CaptionButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  return <Button type="button" variant="soft" size="sm" className="chat-clip-caption" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Caption'}</Button>;
}

/** The clip playing in place: the editor's preview with its own play, seek, time and sound controls. */
function ClipPlayer({ clip, assets, onRefreshMedia, onClose }: { clip: ChatClip; assets: MediaAsset[]; onRefreshMedia?: RefreshPlaybackMedia; onClose: () => void }) {
  const store = useEditorStore(), muted = useEditorState(state => state.muted);
  const preview = useRef<PreviewHandle>(null);
  const [error, setError] = useState('');
  // Opening a card plays it once; a later reload of the player (fresh media links) leaves a paused clip paused.
  const started = useRef(false);
  const canvas = dimensions(clip.timeline.aspectRatio);
  // One preview plays at a time; each starts from its first frame.
  useState(() => { store.setState({ playhead: 0, playing: false, selectedId: null, selectedIds: [] }); return clip.id; });
  useEffect(() => () => { store.setState({ playing: false, playhead: 0 }); }, [store]);
  return <div className="chat-clip-player editor-app conversation-editor" style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}>
    <PreviewZoomProvider canvas={canvas}><div className="stage-center" style={{ '--preview-ratio': canvas.width / canvas.height } as React.CSSProperties}><PreviewViewport>
      <Preview controls ref={preview} timeline={clip.timeline} assets={assets} time={0} onTime={playhead => store.setState({ playhead })} onPlaying={playing => store.setState({ playing })} onError={setError} onRefreshMedia={onRefreshMedia} muted={muted} onMutedChange={next => store.setState({ muted: next })} onReady={() => { setError(''); if (!started.current) { started.current = true; preview.current?.play(); } }} />
    </PreviewViewport></div></PreviewZoomProvider>
    <Button type="button" variant="ghost" size="icon-sm" className="chat-clip-collapse" aria-label="Close player" onClick={onClose}><Minimize2 /></Button>
    {error && <p className="chat-clip-error" role="alert">{error}</p>}
  </div>;
}

export function ChatClips({ clips, assets, onOpenTimeline, onExportAll, post, onRefreshMedia }: {
  clips: ChatClip[]; assets: MediaAsset[];
  /** Opens the full editor, on this clip's tab when one is given. */
  onOpenTimeline: (clipId?: string) => void;
  onExportAll: () => void;
  /** The Post control (export, then post). */
  post?: ReactNode;
  onRefreshMedia?: RefreshPlaybackMedia;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const covers = useMemo(() => new Map(clips.map(clip => [clip.id, timelineCover(clip.timeline, assets)])), [clips, assets]);
  // A clip that was removed stops playing.
  useEffect(() => { if (playing && !clips.some(clip => clip.id === playing)) setPlaying(null); }, [clips, playing]);
  if (!clips.length) return null;
  return <section className="chat-clips" aria-label="Finished clips">
    <div className="chat-clips-row">{clips.map(clip => {
      const hook = hookText(clip.timeline).trim() || clip.name, canvas = dimensions(clip.timeline.aspectRatio), cover = covers.get(clip.id), open = playing === clip.id;
      return <article key={clip.id} className="chat-clip" data-playing={open || undefined} data-wide={canvas.width > canvas.height || undefined}>
        {open ? <ClipPlayer clip={clip} assets={assets} onRefreshMedia={onRefreshMedia} onClose={() => setPlaying(null)} /> : <Button type="button" variant="ghost" className="chat-clip-frame" style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }} aria-label={`Play ${hook}`} onClick={() => setPlaying(clip.id)}>
          {cover ? <img src={cover} alt="" /> : <Film size={22} strokeWidth={1.25} aria-hidden="true" />}
          <Play className="chat-clip-play" aria-hidden="true" />
          <span className="chat-clip-length">{clipLength(timelineDuration(clip.timeline))}</span>
        </Button>}
        {!open && <>
          <p className="chat-clip-hook" title={hook}>{hook}</p>
          <div className="chat-clip-actions"><CaptionButton text={hook} />
            <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" data-slot="button" variant="soft" size="icon-sm" className="chat-clip-more" aria-label={`More for ${hook}`}><Ellipsis /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="chat-clip-menu"><DropdownMenuItem onSelect={() => setPlaying(clip.id)}><Play />Play here</DropdownMenuItem><DropdownMenuItem onSelect={() => onOpenTimeline(clip.id)}><Maximize2 />Open in timeline</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>}
      </article>;
    })}</div>
    <div className="chat-clips-actions">
      <Button type="button" variant="soft" onClick={() => onOpenTimeline()}><Maximize2 />Open timeline</Button>
      <Button type="button" variant="soft" onClick={onExportAll}><Download />{clips.length > 1 ? 'Export all' : 'Export'}</Button>
      {post}
    </div>
  </section>;
}
