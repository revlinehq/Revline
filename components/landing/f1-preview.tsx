'use client';

import { useEffect, useRef, useState } from 'react';

export const F1_VIDEO_ID = 'PWbO4NSObPo';
export const F1_VIDEO_URL = `https://www.youtube.com/watch?v=${F1_VIDEO_ID}`;
export const F1_POSTER = `https://i.ytimg.com/vi/${F1_VIDEO_ID}/hqdefault.jpg`;

type Player = {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
};
type YouTube = { Player: new (element: HTMLElement, options: {
  host: string;
  videoId: string;
  width: string;
  height: string;
  playerVars: Record<string, string | number>;
  events: { onReady: (event: { target: Player }) => void; onError: (event: { data: number }) => void };
}) => Player };
type VideoWindow = Window & { YT?: YouTube; onYouTubeIframeAPIReady?: () => void };
let api: Promise<YouTube> | undefined;

function loadPlayer() {
  const scope = window as VideoWindow;
  if (scope.YT?.Player) return Promise.resolve(scope.YT);
  return api ??= new Promise<YouTube>((resolve, reject) => {
    const previous = scope.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    const timer = window.setTimeout(() => fail(), 15000);
    const fail = () => { clearTimeout(timer); script.remove(); api = undefined; reject(new Error('Video unavailable')); };
    scope.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      if (scope.YT?.Player) resolve(scope.YT); else fail();
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);
  });
}

/** Creator-hosted video; the sample editor never decodes a second video underneath it. */
export function F1Preview({ active, onReady, onTime }: {
  active: boolean;
  onReady: () => void;
  onTime: (time: number) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const latest = useRef({ active, onReady, onTime });
  latest.current = { active, onReady, onTime };
  const [failed, setFailed] = useState(false);
  const [errorCode, setErrorCode] = useState<number>();

  useEffect(() => {
    let cancelled = false;
    let instance: Player | undefined;
    const fail = () => { if (!cancelled) { setFailed(true); latest.current.onReady(); } };
    loadPlayer().then(YT => {
      if (cancelled || !mount.current) return;
      const target = document.createElement('div');
      mount.current.replaceChildren(target);
      instance = new YT.Player(target, {
        host: 'https://www.youtube-nocookie.com', videoId: F1_VIDEO_ID, width: '100%', height: '100%',
        playerVars: { autoplay: 1, mute: 1, controls: 0, playsinline: 1, loop: 1, playlist: F1_VIDEO_ID, rel: 0, origin: window.location.origin },
        events: {
          onReady: ({ target: ready }) => {
            if (cancelled) return;
            player.current = ready;
            ready.mute();
            if (latest.current.active) ready.playVideo(); else ready.pauseVideo();
            latest.current.onReady();
          },
          onError: event => { if (!cancelled) setErrorCode(event.data); fail(); },
        },
      });
    }).catch(fail);
    return () => { cancelled = true; player.current = null; instance?.destroy(); };
  }, []);

  useEffect(() => {
    if (!active) { player.current?.pauseVideo(); return; }
    player.current?.playVideo();
    const timer = window.setInterval(() => {
      if (player.current?.getPlayerState() === 1) latest.current.onTime(player.current.getCurrentTime());
    }, 100);
    return () => clearInterval(timer);
  }, [active]);

  return <div className="preview-canvas landing-f1-preview" data-video-id={F1_VIDEO_ID} data-video-error={errorCode}>
    <img src={F1_POSTER} alt="F1 × NO BATIDAO"/>
    <div ref={mount} className="landing-f1-player" hidden={failed}/>
    {failed && <span className="landing-f1-unavailable">Watch the featured edit using the link below.</span>}
  </div>;
}
