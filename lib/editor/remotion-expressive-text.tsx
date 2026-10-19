import { textGradientFill } from './text-gradient';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Easing, interpolate } from 'remotion';
import { EXPRESSIVE_TEXT_DEFAULTS, type ExpressiveTextPreset, type RemotionTextProps } from './remotion-text';
import { textAppearance, textTypographyStyle } from './text-style';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const bounded = (value: number) => Math.max(0, Math.min(1, value));

function timing(props: RemotionTextProps, frame: number, index = 0, count = 1, word = false) {
  const seconds = props.durationInFrames / props.fps;
  const entrance = Math.min(props.revealDuration ?? EXPRESSIVE_TEXT_DEFAULTS.revealDuration, seconds * .4);
  const stagger = Math.min((props.stagger ?? EXPRESSIVE_TEXT_DEFAULTS.stagger) * (word ? 3 : 1), Math.max(0, seconds * .6 - entrance) / Math.max(1, count - 1));
  const elapsed = frame - index * stagger * props.fps;
  const duration = Math.max(1, Math.round(entrance * props.fps));
  return { elapsed, progress: interpolate(elapsed, [0, duration], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }) };
}

function Words({ text, render }: { text: string; render: (word: string, index: number, count: number) => ReactNode }) {
  const tokens = text.split(/(\s+)/), count = tokens.filter(token => token && !/^\s+$/.test(token)).length;
  let index = 0;
  return <>{tokens.map((token, key) => <Fragment key={key}>{!token || /^\s+$/.test(token) ? token : render(token, index++, count)}</Fragment>)}</>;
}

function ChromaticSplit(props: RemotionTextProps) {
  const strength = props.strength ?? EXPRESSIVE_TEXT_DEFAULTS.strength;
  const shadow = props.textStyle ? textAppearance({ textStyle: props.textStyle }, props.resolution).textShadow : 'none';
  return <Words text={props.text} render={(word, index, count) => {
    const t = timing(props, props.frame, index, count, true), split = (1 - t.progress) * 27 * strength * props.fontSize / 70;
    const jitter = Math.sin(t.elapsed * 2.3) * split * .3;
    const mainShadow = `${split * .15}px 0 ${props.highlightColor},${-split * .15}px 0 #ff598b${shadow === 'none' ? '' : `,${shadow}`}`;
    const copy: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'screen', WebkitTextStroke: '0 transparent' };
    return <span data-word-index={index} style={{ position: 'relative', display: 'inline-block', whiteSpace: 'nowrap', isolation: 'isolate', opacity: bounded(t.progress * 4), transform: `scale(${.9 + t.progress * .1})` }}><span aria-hidden="true" style={{ ...copy, color: props.highlightColor, transform: `translate(${split + jitter}px,${-split * .15}px)`, opacity: (1 - t.progress) * .85 }}>{word}</span><span aria-hidden="true" style={{ ...copy, color: '#ff598b', transform: `translate(${-split + jitter}px,${split * .15}px)`, opacity: (1 - t.progress) * .85 }}>{word}</span><span style={{ position: 'relative', textShadow:mainShadow,...textGradientFill(props.textGradient,props.gradientTime??props.frame/props.fps,mainShadow) }}>{word}</span></span>;
  }}/>;
}

function OutlineTrails(props: RemotionTextProps) {
  const strength = props.strength ?? EXPRESSIVE_TEXT_DEFAULTS.strength, scale = props.fontSize / 70;
  const t = timing(props, props.frame);
  const styleAt = (frame: number): CSSProperties => {
    const p = timing(props, frame).progress;
    return { transform: `translate3d(${(1 - p) * -125 * strength * scale}px,${(1 - p) * 38 * strength * scale}px,0) skewX(${(1 - p) * 12}deg)`, backfaceVisibility:'hidden',willChange:'transform',opacity: bounded(p * 4) };
  };
  return <span style={{ position: 'relative', display: 'grid', alignItems: 'center', justifyItems: 'center', maxWidth: '100%' }}>{[5, 4, 3, 2, 1].map(index => <span aria-hidden="true" key={index} style={{ gridArea: '1/1', display: 'block', maxWidth: '100%', whiteSpace: 'pre-wrap', pointerEvents: 'none', ...styleAt(props.frame - index * (2 + (props.stagger ?? EXPRESSIVE_TEXT_DEFAULTS.stagger) * props.fps)), color: 'transparent', WebkitTextStroke: `${Math.max(.5, 1.2 - index * .12) * scale}px ${props.highlightColor}`, textShadow: 'none', opacity: bounded(t.progress * 4) * (1 - t.progress) * (1 - index * .1) }}>{props.text}</span>)}<span style={{ gridArea: '1/1', display: 'block', maxWidth: '100%', whiteSpace: 'pre-wrap', ...styleAt(props.frame),...textGradientFill(props.textGradient,props.gradientTime??props.frame/props.fps) }}>{props.text}</span></span>;
}

function CinematicFocus(props: RemotionTextProps) {
  const strength = props.strength ?? EXPRESSIVE_TEXT_DEFAULTS.strength;
  return <Words text={props.text} render={(word, index, count) => {
    const t = timing(props, props.frame, index, count, true);
    // Only this hidden resting word participates in layout. Tracking, blur and
    // transforms belong to its absolute copy, so every line break stays fixed.
    return <span data-word-index={index} data-focus-word="" style={{ position: 'relative', display: 'inline-block', whiteSpace: 'nowrap', verticalAlign: 'baseline' }}><span aria-hidden="true" style={{ visibility: 'hidden' }}>{word}</span><span style={{ position: 'absolute', left: '50%', top: 0, whiteSpace: 'nowrap', ...textGradientFill(props.textGradient,props.gradientTime??props.frame/props.fps), opacity: t.progress, filter: `blur(${(1 - t.progress) * 22 * strength * props.fontSize / 70}px)`, transform: `translateX(-50%) translateY(${(1 - t.progress) * .17}em) scale(${1.16 - t.progress * .16})`, letterSpacing: props.textStyle?.letterSpacing === undefined ? `${(1 - t.progress) * .18 * strength - .045}em` : `calc(${props.textStyle.letterSpacing * (props.resolution ?? 1080) / 1080}px + ${(1 - t.progress) * .18 * strength}em)` }}>{word}</span></span>;
  }}/>;
}

function CharacterScramble(props: RemotionTextProps) {
  const strength = props.strength ?? EXPRESSIVE_TEXT_DEFAULTS.strength, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const count = Array.from(props.text.replace(/\s/g, '')).length;
  let characterIndex = 0;
  return <Words text={props.text} render={(word, wordIndex) => <span data-word-index={wordIndex} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>{Array.from(word).map(character => {
    const index = characterIndex++, t = timing(props, props.frame, index, count), resolved = t.progress >= .995;
    const tick = Math.floor(Math.max(0, t.elapsed) / Math.max(1, 3 - strength));
    const glyph = /[\p{L}\p{N}]/u.test(character) && !resolved ? alphabet[(index * 17 + tick * 13 + 7) % alphabet.length] : character;
    return <span key={index} data-character-index={index} style={{ position: 'relative', display: 'inline-block', verticalAlign: 'baseline', opacity: bounded(t.progress * 4), color: resolved ? props.color : props.highlightColor }}><span aria-hidden="true" style={{ visibility: 'hidden' }}>{character}</span><span style={{ position: 'absolute', left: '50%', top: 0, ...textGradientFill(resolved?props.textGradient:undefined,props.gradientTime??props.frame/props.fps), width: '1.5em', marginLeft: '-.75em', textAlign: 'center', transform: `translateY(${resolved ? 0 : Math.sin(tick * 2.4 + index) * 5 * strength * props.fontSize / 70}px)` }}>{glyph}</span></span>;
  })}</span>}/>;
}

function SpotlightSweep(props:RemotionTextProps){
  const t=timing(props,props.frame),strength=props.strength??EXPRESSIVE_TEXT_DEFAULTS.strength;
  const sweep=interpolate(props.frame,[0,Math.max(1,(props.revealDuration??EXPRESSIVE_TEXT_DEFAULTS.revealDuration)*props.fps*2)],[0,1],clamp);
  return <span style={{position:'relative',display:'grid'}}><span style={{gridArea:'1/1',opacity:.12+t.progress*.88,...textGradientFill(props.textGradient,props.gradientTime??props.frame/props.fps)}}>{props.text}</span><span aria-hidden="true" style={{gridArea:'1/1',color:'transparent',backgroundClip:'text',WebkitBackgroundClip:'text',pointerEvents:'none',backgroundImage:`linear-gradient(110deg,transparent 35%,${props.highlightColor} 49%,transparent 63%)`,backgroundSize:'250% 100%',backgroundPosition:`${130-sweep*260}% 0`,opacity:Math.sin(sweep*Math.PI)*Math.min(1,strength),filter:`drop-shadow(0 0 ${strength*5*props.fontSize/70}px ${props.highlightColor})`,WebkitTextStroke:'0 transparent',textShadow:'none'}}>{props.text}</span></span>;
}

function InkWrite(props:RemotionTextProps){
  const strength=props.strength??EXPRESSIVE_TEXT_DEFAULTS.strength;
  return <Words text={props.text} render={(word,index,count)=>{
    const t=timing(props,props.frame,index,count,true),fill=bounded((t.progress-.4)/.6);
    const copy:CSSProperties={position:'absolute',inset:0,whiteSpace:'nowrap',pointerEvents:'none'};
    return <span data-word-index={index} style={{position:'relative',display:'inline-block',whiteSpace:'nowrap'}}><span aria-hidden="true" style={{visibility:'hidden'}}>{word}</span><span aria-hidden="true" style={{...copy,color:'transparent',WebkitTextStroke:`${.012*strength}em ${props.highlightColor}`,clipPath:`inset(0 ${(1-t.progress)*100}% 0 0)`,opacity:bounded(t.progress*4)}}>{word}</span><span style={{...copy,...textGradientFill(props.textGradient,props.gradientTime??props.frame/props.fps),clipPath:`inset(0 ${(1-fill)*100}% 0 0)`,opacity:fill}}>{word}</span></span>;
  }}/>;
}

function EchoTunnel(props:RemotionTextProps){
  const t=timing(props,props.frame),strength=props.strength??EXPRESSIVE_TEXT_DEFAULTS.strength;
  return <span style={{position:'relative',display:'grid',alignItems:'center',justifyItems:'center',maxWidth:'100%'}}>{[4,3,2,1].map(index=><span key={index} aria-hidden="true" style={{gridArea:'1/1',display:'block',maxWidth:'100%',whiteSpace:'pre-wrap',pointerEvents:'none',color:'transparent',WebkitTextStroke:`${.008*strength}em ${props.highlightColor}`,textShadow:'none',transform:`perspective(${props.fontSize*10}px) translateZ(${(1-t.progress)*index*80*strength*props.fontSize/70}px) rotate(${(1-t.progress)*index*-.7}deg)`,opacity:Math.sin(t.progress*Math.PI)*(1-index*.12)}}>{props.text}</span>)}<span style={{gridArea:'1/1',display:'block',maxWidth:'100%',whiteSpace:'pre-wrap',...textGradientFill(props.textGradient,props.gradientTime??props.frame/props.fps),opacity:t.progress,transform:`scale(${.78+t.progress*.22})`}}>{props.text}</span></span>;
}

/** These effects share the production preview/export clock and reserve resting text layout. */
export function RemotionExpressiveText(props: RemotionTextProps & { preset: ExpressiveTextPreset }) {
  const style: CSSProperties = { display: 'inline-block', maxWidth: '100%', fontSize: props.fontSize, color: props.color, fontFamily: props.fontFamily, fontWeight: props.fontWeight, whiteSpace: 'pre-wrap', letterSpacing: '-.045em', ...textTypographyStyle(props.textStyle, props.resolution), ...(props.textStyle ? textAppearance({ textStyle: props.textStyle }, props.resolution) : {}), opacity: props.frame < 0 ? 0 : 1 };
  return <span data-remotion-text={props.preset} data-frame={props.frame} style={style} role="img" aria-label={props.text}><span aria-hidden="true">{props.preset === 'rgb-split' ? <ChromaticSplit {...props}/> : props.preset === 'type-trails' ? <OutlineTrails {...props}/> : props.preset === 'blur-focus' ? <CinematicFocus {...props}/> : props.preset === 'character-scramble' ? <CharacterScramble {...props}/> : props.preset==='spotlight-sweep'?<SpotlightSweep {...props}/>:props.preset==='ink-write'?<InkWrite {...props}/>:<EchoTunnel {...props}/>}</span></span>;
}
