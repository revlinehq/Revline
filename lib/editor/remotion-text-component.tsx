import { Fragment, type CSSProperties } from 'react';
import { Easing, interpolate, spring } from 'remotion';
import type { RemotionTextProps } from './remotion-text';
import { VFX_TEXT_PRESETS } from './remotion-text';
import { RemotionLyricText } from './remotion-lyric-text';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
/** No wall clock, effects, or CSS animation: the same frame always produces the same pixels. */
export function RemotionText({ preset, text, frame, fps, durationInFrames, color, fontSize, highlightColor }: RemotionTextProps) {
  if(VFX_TEXT_PRESETS.some(value=>value===preset))return <RemotionLyricText {...{preset,text,frame,fps,durationInFrames,color,fontSize,highlightColor}}/>;
  const tokens = text.split(/(\s+)/);
  const words = tokens.filter(token => token && !/^\s+$/.test(token));
  const lastFrame = Math.max(0, durationInFrames - 1);
  const revealEnd = Math.min(Math.round(fps * .9), Math.floor(lastFrame * .65));
  const settleFrames = Math.max(1, Math.min(Math.round(fps * .32), lastFrame - revealEnd));
  let wordIndex = 0;
  const slide = lastFrame === 0 ? 1 : interpolate(frame, [0, Math.max(1, Math.min(Math.round(fps * .4), lastFrame))], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const style: CSSProperties = {
    display: 'inline-block', fontSize, color, whiteSpace: 'pre-wrap',
    opacity: frame < 0 ? 0 : 1,
    ...(preset === 'slide-title' ? { opacity: frame < 0 ? 0 : slide, transform: `translateX(${(1 - slide) * -.65}em)` } : {}),
  };
  return <span data-remotion-text={preset} data-frame={frame} style={style}>{tokens.map((token, index) => {
    if (!token || /^\s+$/.test(token)) return <Fragment key={index}>{token}</Fragment>;
    const position = wordIndex++;
    const start = words.length <= 1 ? 0 : Math.round(position * revealEnd / (words.length - 1));
    const elapsed = frame - start;
    const reveal = lastFrame === 0 ? 1 : interpolate(elapsed, [0, Math.max(1, Math.min(Math.round(fps * .12), settleFrames))], [0, 1], clamp);
    let wordStyle: CSSProperties = { display: 'inline-block' };
    if (preset === 'word-reveal') wordStyle = { ...wordStyle, opacity: reveal, transform: `translateY(${(1 - reveal) * .18}em)` };
    if (preset === 'word-pop') {
      const progress = lastFrame === 0 || elapsed >= settleFrames ? 1 : spring({ frame: elapsed, fps, durationInFrames: settleFrames, config: { damping: 14, stiffness: 180, mass: .7 } });
      wordStyle = { ...wordStyle, opacity: reveal, transform: `scale(${interpolate(progress, [0, 1], [.65, 1])})`, transformOrigin: 'center 70%' };
    }
    if (preset === 'karaoke') {
      // This template distributes words across its duration; it does not claim speech alignment.
      const from = position * durationInFrames / Math.max(1, words.length);
      const to = (position + 1) * durationInFrames / Math.max(1, words.length);
      const progress = interpolate(frame + 1, [from, to], [0, 100], clamp);
      wordStyle = { ...wordStyle, color: 'transparent', backgroundImage: `linear-gradient(to right, ${highlightColor} 0% ${progress}%, ${color} ${progress}% 100%)`, backgroundClip: 'text', WebkitBackgroundClip: 'text' };
    }
    return <span key={index} data-word-index={position} style={wordStyle}>{token}</span>;
  })}</span>;
}
