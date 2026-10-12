'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useStore } from 'zustand';
import { ArrowUpRight, Check, Download } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { PrimaryButton } from '@/components/workspace/primary-button';
import { EditorStateProvider } from '@/components/editor/editor-state';
import { EditorPlaybackControls } from '@/components/editor/playback-controls';
import { Preview, type PreviewHandle } from '@/components/editor/preview';
import { PreviewZoomControls, PreviewZoomProvider, PreviewViewport } from '@/components/editor/preview-zoom';
import { createEditorStore } from '@/lib/editor/store';
import { DEMO_ASSETS, DEMO_TIMELINE } from '@/lib/editor/demo';
import { frameSeekTime } from '@/lib/editor/operations';
import { dimensions, timelineDuration, normalizeTimeline, type MediaAsset } from '@/lib/editor/types';
import '@/app/editor.css';

export function ProductDemo() {
  const [store] = useState(() => {
    const timeline = normalizeTimeline({ ...DEMO_TIMELINE, clips: DEMO_TIMELINE.clips.map(clip => ({ ...clip, track: clip.kind === 'caption' ? 2 : 1 })) });
    const instance = createEditorStore(timeline);
    instance.setState({ playhead: 4.2 });
    return instance;
  });
  const timeline = store.getState().timeline;
  const playing = useStore(store, state => state.playing);
  const [assets, setAssets] = useState<MediaAsset[]>(DEMO_ASSETS);
  const [error, setError] = useState('');
  const preview = useRef<PreviewHandle>(null);
  const duration = timelineDuration(timeline);
  const canvas = dimensions(timeline.aspectRatio);
  const time = store.getState().playhead;
  const setTime = useCallback((playhead: number) => store.setState({ playhead }), [store]);
  const setPlaying = useCallback((playing: boolean) => store.setState({ playing }), [store]);
  const readTime = useCallback(() => preview.current?.currentTime() ?? store.getState().playhead, [store]);
  const report = (message: string) => setError(message);
  const seek = (next: number) => {
    const value = frameSeekTime(next, timeline.fps, duration);
    preview.current?.pause(); preview.current?.seek(value); setTime(value);
  };
  const togglePlay = () => {
    if (playing) preview.current?.pause();
    else { if (readTime() >= duration) seek(0); preview.current?.play(); }
  };
  const jump = (direction: -1 | 1) => {
    const current = readTime();
    const cuts = [...new Set([0, duration, ...timeline.clips.filter(item => item.kind === 'video' || item.kind === 'image').flatMap(item => [item.start, item.start + item.duration])])].sort((a, b) => a - b);
    seek(direction < 0 ? cuts.filter(cut => cut < current - 1 / timeline.fps).at(-1) ?? 0 : cuts.find(cut => cut > current + 1 / timeline.fps) ?? duration);
  };

  useEffect(() => {
    let cancelled = false;
    const images = DEMO_ASSETS.filter(asset => asset.kind === 'image' && asset.url).map(asset => {
      const image = new Image();
      image.onload = () => { if (!cancelled && image.naturalWidth && image.naturalHeight) setAssets(current => current.map(item => item._id === asset._id ? { ...item, width: image.naturalWidth, height: image.naturalHeight } : item)); };
      image.src = asset.url!;
      return image;
    });
    return () => { cancelled = true; images.forEach(image => { image.onload = null; }); };
  }, []);

  return <EditorStateProvider store={store}>
    <figure className="landing-product-demo editor-app conversation-editor" aria-label="Revline sample edit" tabIndex={-1} onKeyDown={event => {
      if ((event.target as HTMLElement).closest('input,textarea,select,button,a,[role=button],[role=menuitem]')) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
    }}>
      <nav className="landing-demo-nav" aria-label="Demo editor navigation">
        <Link href="/" className="landing-demo-brand" aria-label="Revline home"><Brand /></Link>
        <span className="landing-demo-project">Weekend in motion</span>
        <span className="landing-demo-saved"><Check size={12} aria-hidden="true" />Saved</span>
        <PrimaryButton asChild size="compact"><Link href="/sign-in">Export <Download size={14} aria-hidden="true" /></Link></PrimaryButton>
      </nav>
      <div className="landing-demo-layout">
        <aside className="landing-demo-chat" aria-label="Sample editing conversation">
          <p className="landing-demo-request">Make a weekend film from these clips. Keep it punchy, with clean captions.</p>
          <div className="landing-demo-response">
            <div className="landing-demo-signature"><Brand markOnly /><strong>Revline</strong></div>
            <p>I found your opening, tightened the pacing, and gave the captions room to breathe.</p>
            <div className="landing-demo-tools">{['9 shots arranged', 'Opening and end card placed', '5 editable captions added'].map(label => <span key={label}><Check size={12} aria-hidden="true" />{label}</span>)}</div>
          </div>
          <div className="landing-demo-chat-footer">
            <p>{error || 'Press play to watch the sample edit.'}</p>
            <Link href="/sign-in">Start editing<ArrowUpRight size={13} aria-hidden="true" /></Link>
          </div>
        </aside>
        <div className="landing-demo-workspace">
          <PreviewZoomProvider canvas={canvas}>
            <section className="landing-demo-preview" aria-label="Sample video preview">
              <div className="landing-demo-preview-toolbar canvas-toolbar"><span>9:16</span><PreviewZoomControls /></div>
              <div className="landing-demo-preview-stage stage-center"><PreviewViewport><Preview ref={preview} timeline={timeline} assets={assets} time={time} onTime={setTime} onPlaying={setPlaying} onError={report} muted={false} /></PreviewViewport></div>
              <EditorPlaybackControls playing={playing} time={time} duration={duration} fps={timeline.fps} readTime={readTime} onTogglePlay={togglePlay} onPrevious={() => jump(-1)} onNext={() => jump(1)} />
            </section>
          </PreviewZoomProvider>
        </div>
      </div>
    </figure>
  </EditorStateProvider>;
}

export { LANDING_DEMO_ASSETS } from './assets';
