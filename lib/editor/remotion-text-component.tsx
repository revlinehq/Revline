import { textGradientFill } from './text-gradient';
import { Fragment, type CSSProperties } from 'react';
import { Easing, interpolate, spring } from 'remotion';
import type { RemotionTextProps } from './remotion-text';
import { EXPRESSIVE_TEXT_PRESETS, VFX_TEXT_PRESETS, type ExpressiveTextPreset } from './remotion-text';
import { RemotionLyricText } from './remotion-lyric-text';
import { RemotionExpressiveText } from './remotion-expressive-text';
import { textAppearance } from './text-style';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
/** No wall clock, effects, or CSS animation: the same frame always produces the same pixels. */
export function RemotionText(props: RemotionTextProps) {
  const { preset, text, frame, fps, durationInFrames, color, fontSize, highlightColor, textStyle, fontFamily, fontWeight, resolution, wordTimings } = props;
  if(EXPRESSIVE_TEXT_PRESETS.some(value=>value===preset))return <RemotionExpressiveText {...props} preset={preset as ExpressiveTextPreset}/>;
  if(VFX_TEXT_PRESETS.some(value=>value===preset))return <RemotionLyricText {...{preset,text,frame,fps,durationInFrames,color,fontSize,highlightColor,textStyle,fontFamily,fontWeight,resolution,textGradient:props.textGradient,gradientTime:props.gradientTime}}/>;
  const tokens = text.split(/(\s+)/);
  const words = tokens.filter(token => token && !/^\s+$/.test(token));
  const lastFrame = Math.max(0, durationInFrames - 1);
  const revealEnd = Math.min(Math.round(fps * .9), Math.floor(lastFrame * .65));
  const settleFrames = Math.max(1, Math.min(Math.round(fps * .32), lastFrame - revealEnd));
  let wordIndex = 0;
  const slide = lastFrame === 0 ? 1 : interpolate(frame, [0, Math.max(1, Math.min(Math.round(fps * .4), lastFrame))], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const style: CSSProperties = {
    display: 'inline-block', fontSize, color, fontFamily, fontWeight, whiteSpace: 'pre-wrap',
    ...(textStyle ? textAppearance({textStyle}, resolution) : {}),
    opacity: frame < 0 ? 0 : 1,
    ...(preset === 'slide-title' ? { opacity: frame < 0 ? 0 : slide, transform: `translateX(${(1 - slide) * -.65}em)` } : {}),
  };
  return <span data-remotion-text={preset} data-frame={frame} style={style}>{tokens.map((token, index) => {
    if (!token || /^\s+$/.test(token)) return <Fragment key={index}>{token}</Fragment>;
    const position = wordIndex++;
    const start = words.length <= 1 ? 0 : Math.round(position * revealEnd / (words.length - 1));
    const elapsed = frame - start;
    const reveal = lastFrame === 0 ? 1 : interpolate(elapsed, [0, Math.max(1, Math.min(Math.round(fps * .12), settleFrames))], [0, 1], clamp);
    let useGradient = true;
    let wordStyle: CSSProperties = { display: 'inline-block' };
    if (preset === 'word-reveal') wordStyle = { ...wordStyle, opacity: reveal, transform: `translateY(${(1 - reveal) * .18}em)` };
    if (preset === 'word-pop') {
      const progress = lastFrame === 0 || elapsed >= settleFrames ? 1 : spring({ frame: elapsed, fps, durationInFrames: settleFrames, config: { damping: 14, stiffness: 180, mass: .7 } });
      wordStyle = { ...wordStyle, opacity: reveal, transform: `scale(${interpolate(progress, [0, 1], [.65, 1])})`, transformOrigin: 'center 70%' };
    }
    if (preset === 'karaoke') {
      const timing=wordTimings?.[position];
      const from = timing ? timing.start*fps : position * durationInFrames / Math.max(1, words.length);
      const to = timing ? timing.end*fps : (position + 1) * durationInFrames / Math.max(1, words.length);
      const highlighted = frame >= from && frame < to;
      useGradient = !highlighted;
      if(timing){
        const elapsed=Math.max(0,frame-from),pop=highlighted?interpolate(elapsed,[0,Math.max(1,fps*.065),Math.max(2,fps*.17)],[.97,1.045,1],{...clamp,easing:Easing.out(Easing.cubic)}):1;
        wordStyle={...wordStyle,padding:'.035em .12em',borderRadius:'.12em',backgroundColor:highlighted?highlightColor:'transparent',color:highlighted?'#17131F':color,opacity:frame<from ? .75 : 1,transform:`scale(${pop})`,transformOrigin:'center',...(highlighted?{WebkitTextStroke:'0 transparent',textShadow:'none'}:{})};
      }else wordStyle = { ...wordStyle, color: highlighted ? highlightColor : color };
    }
    return <span key={index} data-word-index={position} style={{...wordStyle,...textGradientFill(useGradient?props.textGradient:undefined,props.gradientTime??frame/fps,textStyle?textAppearance({textStyle},resolution).textShadow:undefined)}}>{token}</span>;
  })}</span>;
}
