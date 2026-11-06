import type { CSSProperties, ReactNode } from 'react';
import { TemplateText } from '@/lib/editor/template-text';
import { type LabConfig } from './motion-lab-model';
import { isLabExtraTextPreset } from './motion-lab-text-presets';
import { MotionLabTypography } from './motion-lab-typography';
import { MotionLabBlock } from './motion-lab-blocks';


function Typography({ config, frame }: { config: LabConfig; frame: number }) {
  const text = config.textPreset === 'karaoke' ? config.words.map(word => word.word).join(' ') : config.title;
  const content=isLabExtraTextPreset(config.textPreset) ? <MotionLabTypography config={config} frame={frame} preset={config.textPreset}/> : <TemplateText
    preset={config.textPreset} text={text} frame={frame} fps={config.fps} durationInFrames={Math.round(config.duration * config.fps)}
    color={config.foreground} highlightColor={config.accent} fontSize={config.textSize} fontFamily="var(--font-space-grotesk), sans-serif" fontWeight={700}
    strength={config.textStrength} revealDuration={config.entrance} stagger={config.textStagger}
    {...(config.textPreset === 'karaoke' ? { wordTimings: config.words.map(({ start, end }) => ({ start, end })) } : {})}
  />;
  return <div className="rmlab-scene-typography"><span className="rmlab-type-rule"/><DepthAppearance config={config}>{content}</DepthAppearance><span className="rmlab-type-footer">WORDS THAT MOVE PEOPLE.</span></div>;
}

function DepthAppearance({config,children}:{config:LabConfig;children:ReactNode}){
  if(config.textDepthStyle==='flat')return children;
  const samples=Math.min(8,Math.max(1,Math.ceil(config.textDepth))),neon=config.textDepthStyle==='neon-depth';
  return <span className="rmlab-type-depth" data-depth-style={config.textDepthStyle} style={{transform:`perspective(900px) rotateX(${config.textTiltX}deg) rotateY(${config.textTiltY}deg)`,filter:neon?`drop-shadow(0 0 ${config.textDepth*.7}px ${config.accent})`:undefined}}>{Array.from({length:samples},(_,index)=>{
    const depth=config.textDepth*(samples-index)/samples;
    return <span className="rmlab-type-depth-slice" aria-hidden="true" key={index} style={{transform:`translate3d(${depth*.65}px,${depth*.85}px,${-depth}px)`,filter:config.textDepthStyle==='chrome'?`brightness(${.5+index/samples*.45}) saturate(0)`:`brightness(${neon?.6:.3}) saturate(.65)`,opacity:neon?.6:1}}>{children}</span>;
  })}<span className="rmlab-type-depth-front">{children}</span></span>;
}

/** A seekable composition: every visible value is a pure function of config and frame. */
export function MotionLabScene({ config, frame }: { config: LabConfig; frame: number }) {
  if(config.scene!=='typography')return <MotionLabBlock config={config} frame={frame}/>;
  const style = { '--lab-accent': config.accent, '--lab-foreground': config.foreground, color: config.foreground, background: config.background } as CSSProperties;
  return <div className="rmlab-scene" data-scene={config.scene} data-portrait={config.aspect === 'portrait'} data-frame={frame} style={style}>
    <div className="rmlab-scene-texture" aria-hidden="true"/>
    <header className="rmlab-scene-heading"><span className="rmlab-scene-eyebrow"><i/>{config.subtitle}</span></header>
    {config.showGuides ? <div className="rmlab-safe-guides" aria-hidden="true"><span>SAFE AREA</span></div> : null}
    <Typography config={config} frame={frame}/>
    <footer className="rmlab-scene-footer"><span>REVLINE <i>/</i> MOTION LAB</span><span>{config.aspect === 'portrait' ? '09:16' : '16:09'}</span></footer>
  </div>;
}
