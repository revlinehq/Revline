import { textGradientFill } from './text-gradient';
import { Fragment, type CSSProperties } from 'react';
import { Easing, interpolate, spring } from 'remotion';
import type { RemotionTextProps } from './remotion-text';
import { textAppearance, textTypographyStyle } from './text-style';

const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
const progress=(frame:number,from:number,to:number)=>interpolate(frame,[from,Math.max(from+.001,to)],[0,1],clamp);

/** Frame-derived entrance, hold and exit. Frozen template timing survives split/trim. */
function lyricTextTiming(frame:number,fps:number,durationInFrames:number){
  const last=Math.max(0,durationInFrames-1);
  const enter=Math.min(fps*.34,last*.28),exit=Math.min(fps*.28,last*.24);
  const entering=last<=1?1:progress(frame,0,enter);
  const exiting=last<=1?0:progress(frame,last-exit,last);
  return {last,enter,exit,entering,exiting,visible:frame>=0&&frame<=last,seconds:frame/fps};
}

function NeonEcho(props:RemotionTextProps){
  const {text,frame,fps,durationInFrames,color,highlightColor}=props;
  const timing=lyricTextTiming(frame,fps,durationInFrames);
  const settle=timing.last<=1?1:spring({frame:Math.max(0,frame),fps,durationInFrames:Math.max(1,timing.enter),config:{damping:13,stiffness:190,mass:.7}});
  const pulse=(Math.sin(timing.seconds*Math.PI*2/1.15)+1)/2;
  const opacity=timing.visible?Math.min(1,timing.entering*3)*(1-timing.exiting):0;
  const spread=(1-timing.entering)*.35+timing.exiting*.22;
  const custom=props.textStyle?textAppearance(props,props.resolution):undefined;
  const ghost:CSSProperties={position:'absolute',inset:0,whiteSpace:'inherit',color:'transparent',WebkitTextStroke:custom?.WebkitTextStroke??`.025em ${highlightColor}`,textShadow:'none',pointerEvents:'none'};
  return <span data-text-phase={timing.exiting>0?'exit':timing.entering<1?'enter':'hold'} style={{display:'inline-block',position:'relative',opacity,transform:`translateY(${-timing.exiting*.2}em) scale(${1.18-.18*settle+timing.exiting*.06+pulse*.008*timing.entering})`,transformOrigin:'center'}}>
    <span aria-hidden="true" data-text-layer="echo" style={{...ghost,opacity:.34+pulse*.16,transform:`translate(${.065+spread}em,${-.055-spread*.3}em) scale(1.015)`,filter:'blur(.015em)'}}>{text}</span>
    <span aria-hidden="true" data-text-layer="echo" style={{...ghost,opacity:.18+pulse*.08,transform:`translate(${- .085-spread}em,${.075+spread*.3}em) scale(1.035)`,filter:'blur(.025em)'}}>{text}</span>
    <span data-text-layer="main" style={{position:'relative',display:'inline-block',color,WebkitTextStroke:`.048em ${highlightColor}`,paintOrder:'stroke fill',textShadow:`0 0 .13em ${highlightColor},0 0 .36em ${color}`,...custom,...textGradientFill(props.textGradient,props.gradientTime??frame/fps,custom?.textShadow??`0 0 .13em ${highlightColor},0 0 .36em ${color}`)}}>{text}</span>
  </span>;
}

function LyricSlam(props:RemotionTextProps){
  const {text,frame,fps,durationInFrames,color,highlightColor}=props;
  const timing=lyricTextTiming(frame,fps,durationInFrames);
  const settle=timing.last<=1?1:spring({frame:Math.max(0,frame),fps,durationInFrames:Math.max(1,timing.enter),config:{damping:10,stiffness:240,mass:.8}});
  const exit=Easing.in(Easing.cubic)(timing.exiting);
  const opacity=timing.visible?Math.min(1,timing.entering*4)*(1-exit):0;
  const custom=props.textStyle?textAppearance(props,props.resolution):undefined;
  return <span data-text-layer="main" data-text-phase={timing.exiting>0?'exit':timing.entering<1?'enter':'hold'} style={{display:'inline-block',position:'relative',opacity,color,WebkitTextStroke:`.028em ${highlightColor}`,paintOrder:'stroke fill',textShadow:`.045em .05em 0 ${highlightColor},0 .07em .14em #0009`,...custom,...textGradientFill(props.textGradient,props.gradientTime??frame/fps,custom?.textShadow??`.045em .05em 0 ${highlightColor},0 .07em .14em #0009`),transform:`translateY(${(1-settle)*.45-exit*.6}em) rotate(${(1-settle)*-4+exit*2}deg) scale(${1.45-.45*settle+exit*.12},${.58+.42*settle-exit*.2})`,transformOrigin:'center 60%'}}>{text}{!props.textStyle&&<span aria-hidden="true" data-text-accent="underline" style={{position:'absolute',left:0,right:0,bottom:'-.10em',height:'.07em',borderRadius:'.04em',background:highlightColor,transform:`scaleX(${timing.entering*(1-exit)})`,transformOrigin:'left',opacity:.9}}/>}</span>;
}

function KineticStack(props:RemotionTextProps){
  const {text,frame,fps,durationInFrames,color,highlightColor}=props;
  const timing=lyricTextTiming(frame,fps,durationInFrames);
  const tokens=text.split(/(\s+)/),words=tokens.filter(token=>token&&!/^\s+$/.test(token));
  const reveal=Math.min(fps*.5,timing.last*.35),settle=Math.max(1,Math.min(fps*.32,timing.last*.25));
  let position=0;
  const custom=props.textStyle?textAppearance(props,props.resolution):undefined;
  return <span data-text-phase={timing.exiting>0?'exit':frame<reveal+settle?'enter':'hold'} style={{display:'inline-block',opacity:timing.visible?1:0}}>{tokens.map((token,index)=>{
    if(!token||/^\s+$/.test(token))return <Fragment key={index}>{token}</Fragment>;
    const word=position++,from=words.length<=1?0:word*reveal/(words.length-1),elapsed=frame-from;
    const entrance=timing.last<=1?1:spring({frame:Math.max(0,elapsed),fps,durationInFrames:settle,config:{damping:15,stiffness:170,mass:.75}});
    const fade=timing.last<=1?1:progress(elapsed,0,Math.min(fps*.12,settle));
    const exitFrom=timing.last-timing.exit+(words.length<=1?0:word/words.length*timing.exit*.35),exit=timing.last<=1?0:progress(frame,exitFrom,timing.last);
    const lift=(1-entrance)*.75-exit*.45,tilt=(1-entrance)*(word%2?-5:5);
    const accent=word===words.length-1;
    return <span key={index} data-word-index={word} style={{display:'inline-block',position:'relative',opacity:fade*(1-exit),color:custom?color:accent?highlightColor:color,WebkitTextStroke:`.016em ${accent?color:highlightColor}`,paintOrder:'stroke fill',textShadow:'0 .045em .08em #000a',...custom,...textGradientFill(props.textGradient,props.gradientTime??frame/fps,custom?.textShadow??'0 .045em .08em #000a'),transform:`translate(${(1-entrance)*(word%2?.12:-.12)}em,${lift}em) rotate(${tilt}deg) scale(${.82+.18*entrance-exit*.08})`,transformOrigin:'center 75%'}}>{token}{accent&&!props.textStyle&&<span aria-hidden="true" data-text-accent="underline" style={{position:'absolute',left:0,right:0,bottom:'-.09em',height:'.055em',background:highlightColor,borderRadius:'.035em',transform:`scaleX(${Math.min(1,entrance)*(1-exit)})`,transformOrigin:'left'}}/>}</span>;
  })}</span>;
}

/** Shared by the canvas composition and exact-frame export; no independent clock. */
export function RemotionLyricText(props:RemotionTextProps){
  const style:CSSProperties={display:'inline-block',fontSize:props.fontSize,color:props.color,fontWeight:props.fontWeight??900,fontFamily:props.fontFamily,letterSpacing:props.textStyle?'inherit':'-.045em',lineHeight:props.textStyle?'inherit':1.05,whiteSpace:'pre-wrap',textTransform:props.textStyle?'none':'uppercase',...textTypographyStyle(props.textStyle,props.resolution)};
  return <span data-remotion-text={props.preset} data-frame={props.frame} style={style}>{props.preset==='neon-echo'?<NeonEcho {...props}/>:props.preset==='lyric-slam'?<LyricSlam {...props}/>:<KineticStack {...props}/>}</span>;
}
