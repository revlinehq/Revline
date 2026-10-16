'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { RemotionText } from '@/lib/editor/remotion-text-component';
import { remotionTextProps } from '@/lib/editor/remotion-text';
import { editorTextFont } from '@/lib/editor/text-fonts';
import { TextFontStyles } from '@/components/editor/text-font-styles';
import type { Clip } from '@/lib/editor/types';
import cues from '@/lib/editor/hormozi-demo-captions.json';
import { FEATURE_BEAT_SECONDS, FEATURE_MEDIA, FEATURE_MOMENTS, type FeatureMediaKind } from './features-media-config';

const fps = 30, compositionWidth = 960;
// A pulse per edit boundary illustrates the prepared grid; it is not measured audio.
const rhythmGuide = Array.from({ length: 96 }, (_, index) => [92, 66, 42, 26, 17, 12, 10, 14][index % 8]);
const title: Clip = { id: 'landing-motion-title', kind: 'graphic', start: 0, duration: 3.6, sourceStart: 0, text: 'MAKE IT\nMOVE.', fontSize: 172, fontFamily: 'space-grotesk', color: '#FFFFFF', textTemplate: { preset: 'type-trails', highlightColor: '#C4B5FD', strength: .9, revealDuration: .8, stagger: .08 } };
const captionClips: Clip[] = cues.filter(cue => cue.start >= 2.5 && cue.start < 9.1).map((cue, index) => ({
  id: `landing-caption-${index}`, kind: 'caption', start: cue.start, duration: cue.end - cue.start, sourceStart: 0, text: cue.text.toUpperCase(), fontFamily: 'anton', fontSize: 82, color: '#FFFFFF',
  textTemplate: { preset: 'karaoke', highlightColor: '#C4B5FD', wordTimings: cue.words.map(word => ({ start: word.start - cue.start, end: word.end - cue.start })) },
  textStyle: { strokeWidth: 1.5, strokeColor: '#000000', shadowBlur: 5, shadowX: 0, shadowY: 3, shadowColor: '#000000B3', glowBlur: 0, glowColor: '#000000' },
}));

/** Only the visible tab mounts this player. Its media clock also drives product text. */
export function FeatureMedia({ kind }: { kind: FeatureMediaKind }) {
  const media = FEATURE_MEDIA[kind], video = useRef<HTMLVideoElement>(null), portrait = useRef<HTMLVideoElement>(null), surface = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true), [time, setTime] = useState(media.start), [scale, setScale] = useState(0);
  const playbackRate = kind === 'moments' ? 2 : 1;

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / compositionWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.defaultPlaybackRate = playbackRate;element.playbackRate = playbackRate;
    let callback: number | undefined;
    const end = () => Number.isFinite(element.duration) ? Math.min(media.end, element.duration) : media.end;
    const update = () => {
      if (element.currentTime >= end() - .04 || element.currentTime < media.start - .04) {
        element.currentTime = media.start;
        if (playing && !document.hidden) { void element.play().catch(() => setPlaying(false));void portrait.current?.play().catch(() => {}); }
      }
      setTime(element.currentTime);
      const copy = portrait.current;
      if (copy && copy.readyState >= 2 && Math.abs(copy.currentTime - element.currentTime) > .12) copy.currentTime = element.currentTime;
    };
    const frame = () => { update();callback = element.requestVideoFrameCallback?.(frame); };
    const playback = () => {
      if (playing && !document.hidden) {
        void element.play().catch(() => setPlaying(false));
        void portrait.current?.play().catch(() => {});
        if (callback === undefined && element.requestVideoFrameCallback) callback = element.requestVideoFrameCallback(frame);
      } else {
        element.pause();portrait.current?.pause();
        if (callback !== undefined) element.cancelVideoFrameCallback(callback);
        callback = undefined;
      }
    };
    const loaded = () => { element.playbackRate = playbackRate;element.currentTime = media.start;setTime(media.start);playback(); };
    element.addEventListener('loadedmetadata', loaded);
    element.addEventListener('timeupdate', update);
    document.addEventListener('visibilitychange', playback);
    if (element.readyState >= 1) playback();
    return () => {
      element.pause();portrait.current?.pause();
      if (callback !== undefined) element.cancelVideoFrameCallback(callback);
      element.removeEventListener('loadedmetadata', loaded);element.removeEventListener('timeupdate', update);document.removeEventListener('visibilitychange', playback);
    };
  }, [media, playing, playbackRate]);

  const elapsed = Math.max(0, time - media.start), progress = Math.min(1, elapsed / (media.end - media.start));
  const subtitle = captionClips.find(clip => time >= clip.start && time < clip.start + clip.duration);
  const titleTime = elapsed % title.duration;
  const words = kind === 'titles' ? remotionTextProps(title, titleTime, fps, 540) : kind === 'captions' && subtitle ? remotionTextProps(subtitle, time, fps, 540) : null;
  const shot = FEATURE_MOMENTS.findLastIndex(moment => elapsed >= moment.start);
  // The crop guide and output use the same path over this selected shot.
  const focus = .5, cropRatio = 81 / 256, portraitPosition = (focus - cropRatio / 2) / (1 - cropRatio);
  const beat = Math.floor(elapsed / FEATURE_BEAT_SECONDS), beatCount = Math.round((media.end - media.start) / FEATURE_BEAT_SECONDS);
  const beatPhase = elapsed / FEATURE_BEAT_SECONDS - beat, pulse = Math.max(0, 1 - beatPhase / .48);

  return <div className={`feature-demo feature-demo-${kind}`} ref={surface} data-feature-media={kind} data-playing={playing}>
    <TextFontStyles/>
    <div className="feature-demo-footage">
      <video ref={video} src={media.src} poster={media.poster} autoPlay muted playsInline preload="metadata" width={960} height={540} aria-label={kind === 'captions' ? 'A conversation with speech-timed captions' : 'Editing feature video preview'} />
      {kind === 'subject' ? <div className="feature-demo-crop-guide" style={{ left: `${focus * 100}%` }}><span>9:16</span></div> : null}
    </div>
    {kind === 'titles' || kind === 'captions' ? <div className="feature-demo-text-surface" style={{ transform: `scale(${scale})` }} aria-hidden="true"><div className={`feature-demo-product-text feature-demo-product-text-${kind}`}>{words ? <RemotionText {...words} fontFamily={editorTextFont(kind === 'titles' ? title.fontFamily : subtitle?.fontFamily).family}/> : null}</div></div> : null}
    {kind === 'moments' ? <div className="feature-demo-selects" aria-hidden="true"><div className="feature-demo-selects-heading"><span>YOUR SELECTS</span><strong>Keep the good parts.</strong></div><div className="feature-demo-shot-list">{FEATURE_MOMENTS.map((moment, index) => <div key={moment.label} data-selected={shot === index}><img src={moment.poster} alt="" width={240} height={135} loading="lazy"/><span>{moment.label}</span><small>{`00:${Math.floor(moment.start).toString().padStart(2, '0')}`}</small></div>)}</div></div> : null}
    {kind === 'beats' ? <div className="feature-demo-rhythm" aria-hidden="true" data-beat-index={beat}>
      <div className="feature-demo-rhythm-heading"><span>CUTS ON THE BEAT</span><span><i className="feature-demo-beat-pulse" style={{ opacity: .5 + pulse * .5, transform: `scale(${.8 + pulse * .35})`, boxShadow: `0 0 0 ${pulse * 4}px #c4b5fd28` }}/>120 BPM</span></div>
      <div className="feature-demo-rhythm-lanes">
        <div className="feature-demo-cut-strip">{Array.from({ length: beatCount }, (_, index) => <span key={index} data-beat-active={beat === index} data-beat-past={index < beat}><img src={FEATURE_MOMENTS[index % FEATURE_MOMENTS.length].poster} alt="" width={120} height={68} loading="lazy"/><small>{String(index + 1).padStart(2, '0')}</small></span>)}</div>
        <div className="feature-demo-audio-wave">{rhythmGuide.map((height, index) => <i key={index} data-beat-past={index / rhythmGuide.length <= progress} style={{ height: `${height}%` }}/>)}</div>
        <div className="feature-demo-beat-markers">{Array.from({ length: beatCount }, (_, index) => <i key={index} style={{ left: `${index / beatCount * 100}%` }}/>)}</div>
        <div className="feature-demo-playhead" style={{ left: `${progress * 100}%` }}/>
      </div>
      <div className="feature-demo-rhythm-footer"><span>Rhythm guide</span><span>{String(Math.min(beatCount, beat + 1)).padStart(2, '0')} / {beatCount} cuts</span></div>
    </div> : null}
    {kind === 'subject' ? <><span className="feature-demo-reframe-arrow" aria-hidden="true">→</span><div className="feature-demo-portrait"><video ref={portrait} src={media.src} poster={media.poster} muted playsInline loop preload="metadata" width={304} height={540} style={{ objectPosition: `${portraitPosition * 100}% 50%` }} onLoadedMetadata={event => { const copy = event.currentTarget;copy.currentTime = video.current?.currentTime ?? media.start;if (playing && !document.hidden) void copy.play().catch(() => {}); }} aria-label="The same shot reframed vertically"/><span>9:16</span></div></> : null}
    <span className="feature-demo-label">{kind === 'titles' ? 'Outline trails' : kind === 'moments' ? 'Selects' : kind === 'beats' ? 'Beat-synced cuts' : kind === 'subject' ? '16:9 → 9:16' : 'Word by word'}</span>
    {kind !== 'captions' ? <a className="feature-demo-credit" href="https://svs.gsfc.nasa.gov/31385/" target="_blank" rel="noreferrer noopener">Footage: NASA</a> : null}
    <button type="button" className="feature-demo-play" aria-label={playing ? 'Pause feature preview' : 'Play feature preview'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}</button>
  </div>;
}
