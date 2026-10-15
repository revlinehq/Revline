import type { CSSProperties, ReactNode } from 'react';
import { Easing, interpolate } from 'remotion';
import { RemotionText } from '@/lib/editor/remotion-text-component';
import { labProgress, type LabConfig } from './remotion-lab-model';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const bounded = (value: number) => Math.min(1, Math.max(0, value));

function Mark({ index, color }: { index: number; color: string }) {
  return <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ color }}>
    {index === 0 ? <><rect x="6" y="6" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="2"/><path d="M6 13h20M13 13v13" stroke="currentColor" strokeWidth="2"/></> : index === 1 ? <><path d="m16 4 12 7-12 7L4 11l12-7Zm-12 14 12 7 12-7M4 23l12 7 12-7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></> : <><circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/><path d="M16 7v9l6 3M9 5l-4 5M23 5l4 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></>}
  </svg>;
}

function MotionTile({ config, frame, start, className = '', children }: { config: LabConfig; frame: number; start: number; className?: string; children: ReactNode }) {
  const styleAt = (sampleFrame: number): CSSProperties => {
    const p = labProgress(config, sampleFrame, start);
    return { opacity: bounded(p * 2), transform: `translateY(${(1 - p) * config.distance}px) scale(${.92 + p * .08})` };
  };
  return <div className={`rmlab-motion-tile ${className}`}>
    {config.blur > 0 ? [4, 3, 2, 1].map(sample => <div key={sample} aria-hidden="true" className="rmlab-motion-sample" style={{ ...styleAt(frame - sample * config.blur / 5), opacity: bounded(labProgress(config, frame - sample * config.blur / 5, start) * 2) * .065, filter: `blur(${sample / 2}px)` }}>{children}</div>) : null}
    <div className="rmlab-motion-current" style={styleAt(frame)}>{children}</div>
  </div>;
}

function SceneHeading({ config, frame }: { config: LabConfig; frame: number }) {
  const p = labProgress(config, frame);
  return <header className="rmlab-scene-heading" style={{ opacity: bounded(p), transform: `translateY(${(1 - p) * 18}px)` }}>
    <span className="rmlab-scene-eyebrow"><i />{config.subtitle}</span>
    <h2>{config.title}</h2>
  </header>;
}

function Cards({ config, frame }: { config: LabConfig; frame: number }) {
  return <div className="rmlab-scene-cards">{config.items.map((item, index) => {
    const p = bounded(labProgress(config, frame, item.start));
    return <MotionTile key={index} config={config} frame={frame} start={item.start}>
      <article className="rmlab-scene-card">
        <div className="rmlab-card-top"><Mark index={index} color={config.accent}/><span>0{index + 1}</span></div>
        <h3>{item.label}</h3><p>{item.detail}</p>
        <div className="rmlab-card-value"><span>{Math.round(item.value * p)}<small>%</small></span><div><i style={{ width: `${Math.min(100, item.value) * p}%` }}/></div></div>
      </article>
    </MotionTile>;
  })}</div>;
}

function Diagram({ config, frame }: { config: LabConfig; frame: number }) {
  const portrait = config.aspect === 'portrait';
  return <div className="rmlab-scene-diagram">
    <svg viewBox={portrait ? '0 0 400 470' : '0 0 800 240'} preserveAspectRatio="none" aria-hidden="true" className="rmlab-diagram-lines">
      {[0, 1].map(index => {
        const p = bounded(labProgress(config, frame, config.items[index + 1].start - .35));
        const d = portrait ? `M200 ${116 + index * 155}v36` : `M${230 + index * 275} 120h70`;
        return <g key={index}><path d={d} stroke="currentColor" strokeOpacity=".1" strokeWidth="2"/><path d={d} stroke={config.accent} strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - p}/></g>;
      })}
    </svg>
    <div className="rmlab-diagram-nodes">{config.items.map((item, index) => <MotionTile key={index} config={config} frame={frame} start={item.start}>
      <article className="rmlab-diagram-node"><span className="rmlab-node-number">{String(index + 1).padStart(2, '0')}</span><h3>{item.label}</h3><p>{item.detail}</p><span className="rmlab-node-dot"/></article>
    </MotionTile>)}</div>
  </div>;
}

function Arrows({ config, frame }: { config: LabConfig; frame: number }) {
  const portrait = config.aspect === 'portrait';
  const points = portrait ? [[85, 90], [315, 270], [100, 460]] : [[135, 65], [665, 65], [665, 250]];
  const center = portrait ? [200, 270] : [355, 160];
  const p = labProgress(config, frame, .25);
  return <div className="rmlab-scene-arrows">
    <svg viewBox={portrait ? '0 0 400 550' : '0 0 800 320'} preserveAspectRatio="none" aria-hidden="true">
      {points.map(([x, y], index) => {
        const progress = bounded(labProgress(config, frame, config.items[index].start));
        return <g key={index}><path d={`M${center[0]} ${center[1]}Q${x} ${center[1]} ${x} ${y}`} fill="none" stroke={config.accent} strokeWidth="2.5" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress}/><circle cx={x} cy={y} r="5" fill={config.accent} opacity={progress}/></g>;
      })}
    </svg>
    <div className="rmlab-arrow-center" style={{ opacity: bounded(p), transform: `translate(-50%,-50%) scale(${p})` }}><Mark index={0} color={config.accent}/><strong>The offer</strong><span>START HERE</span></div>
    {config.items.map((item, index) => <div className={`rmlab-callout rmlab-callout-${index}`} key={index} style={{ opacity: bounded(labProgress(config, frame, item.start)), transform: `translateY(${(1 - labProgress(config, frame, item.start)) * 20}px)` }}><small>0{index + 1}</small><h3>{item.label}</h3><p>{item.detail}</p></div>)}
  </div>;
}

function Chart({ config, frame }: { config: LabConfig; frame: number }) {
  const max = Math.max(1, ...config.items.map(item => item.value));
  const total = config.items.reduce((sum, item) => sum + Math.round(item.value * bounded(labProgress(config, frame, item.start))), 0);
  return <div className="rmlab-scene-chart">
    <div className="rmlab-chart-summary"><span>{config.counterPrefix}{total.toLocaleString('en-US')}{config.counterSuffix}</span><small>Combined total</small></div>
    <div className="rmlab-chart-plot"><div className="rmlab-chart-grid">{[100, 75, 50, 25].map(percent => <div key={percent}><small>{Math.round(max * percent / 100)}</small></div>)}</div>
      <div className="rmlab-chart-bars">{config.items.map((item, index) => {
        const p = bounded(labProgress(config, frame, item.start));
        return <div className="rmlab-chart-column" key={index}><div className="rmlab-chart-bar-space"><div className="rmlab-chart-bar" style={{ height: `${item.value / max * 100 * p}%`, opacity: .5 + index * .25 }}><span>{Math.round(item.value * p)}</span></div></div><strong>{item.label}</strong></div>;
      })}</div>
    </div>
  </div>;
}

function Counter({ config, frame }: { config: LabConfig; frame: number }) {
  const item = config.items[0];
  const p = interpolate(frame - item.start * config.fps, [0, config.entrance * config.fps * 2], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const entrance = labProgress(config, frame, item.start);
  const number = `${config.counterPrefix}${Math.round(item.value * p).toLocaleString('en-US')}`;
  const size = Math.min(104, (config.aspect === 'portrait' ? 430 : 760) / Math.max(1, (number.length + config.counterSuffix.length * .5) * .58));
  return <div className="rmlab-scene-counter" style={{ opacity: bounded(entrance), transform: `translateY(${(1 - entrance) * config.distance}px) scale(${.9 + entrance * .1})` }}>
    <div className="rmlab-counter-orbit" aria-hidden="true"><i/><i/><i/></div>
    <span className="rmlab-counter-number" style={{ fontSize: size }}>{number}<small>{config.counterSuffix}</small></span>
    <strong>{item.label}</strong><p>{item.detail}</p><div className="rmlab-counter-line"><i style={{ width: `${p * 100}%` }}/></div>
  </div>;
}

function Typography({ config, frame }: { config: LabConfig; frame: number }) {
  const text = config.textPreset === 'karaoke' ? config.words.map(word => word.word).join(' ') : config.title;
  return <div className="rmlab-scene-typography"><span className="rmlab-type-rule"/><RemotionText
    preset={config.textPreset} text={text} frame={frame} fps={config.fps} durationInFrames={Math.round(config.duration * config.fps)}
    color={config.foreground} highlightColor={config.accent} fontSize={config.textSize} fontFamily="var(--font-space-grotesk), sans-serif" fontWeight={700}
    {...(config.textPreset === 'karaoke' ? { wordTimings: config.words.map(({ start, end }) => ({ start, end })) } : {})}
  /><span className="rmlab-type-footer">WORDS THAT MOVE PEOPLE.</span></div>;
}

function Polish({ config, frame }: { config: LabConfig; frame: number }) {
  const portrait = config.aspect === 'portrait';
  const travel = portrait ? 245 : 525;
  return <div className="rmlab-scene-polish">{(['linear', 'ease', 'spring'] as const).map((motion, index) => {
    const rowConfig = { ...config, motion };
    const p = labProgress(rowConfig, frame, .6);
    const position = (sample: number) => labProgress(rowConfig, sample, .6) * travel;
    return <div className="rmlab-polish-row" key={motion}><span>{['Linear', 'Cubic ease out', 'Remotion spring'][index]}</span><div className="rmlab-polish-track"><i className="rmlab-polish-target"/>
      {config.blur > 0 ? [5, 4, 3, 2, 1].map(sample => <div key={sample} aria-hidden="true" className="rmlab-polish-ball rmlab-polish-ghost" style={{ transform: `translateX(${position(frame - sample * config.blur / 4)}px) rotate(${position(frame - sample * config.blur / 4) / 7}deg)`, opacity: .09, filter: `blur(${sample * .7}px)` }}/>) : null}
      <div className="rmlab-polish-ball" style={{ transform: `translateX(${p * travel}px) rotate(${p * 75}deg)` }}><span>✳</span></div>
    </div><small>{p.toFixed(3)}</small></div>;
  })}<div className="rmlab-polish-caption">Same distance. Same duration. Different feeling.</div></div>;
}

function Transcript({ config, frame }: { config: LabConfig; frame: number }) {
  return <div className="rmlab-scene-transcript" aria-label="Timed transcript">{config.words.map((word, index) => <span key={index} data-active={frame >= word.start * config.fps && frame < word.end * config.fps} style={{ opacity: frame < word.start * config.fps ? .38 : 1 }}>{word.word}{' '}</span>)}</div>;
}

/** A seekable composition: every visible value is a pure function of config and frame. */
export function RemotionLabScene({ config, frame }: { config: LabConfig; frame: number }) {
  const style = { '--lab-accent': config.accent, '--lab-foreground': config.foreground, color: config.foreground, background: config.background } as CSSProperties;
  return <div className="rmlab-scene" data-scene={config.scene} data-portrait={config.aspect === 'portrait'} data-frame={frame} style={style}>
    <div className="rmlab-scene-texture" aria-hidden="true"/>
    {config.showGuides ? <div className="rmlab-safe-guides" aria-hidden="true"><span>SAFE AREA</span></div> : null}
    <SceneHeading config={config} frame={frame}/>
    {config.scene === 'cards' ? <Cards config={config} frame={frame}/> : config.scene === 'diagram' ? <Diagram config={config} frame={frame}/> : config.scene === 'arrows' ? <Arrows config={config} frame={frame}/> : config.scene === 'chart' ? <Chart config={config} frame={frame}/> : config.scene === 'counter' ? <Counter config={config} frame={frame}/> : config.scene === 'typography' ? <Typography config={config} frame={frame}/> : <Polish config={config} frame={frame}/>}
    {config.showTranscript && config.scene !== 'typography' && config.scene !== 'polish' ? <Transcript config={config} frame={frame}/> : null}
    <footer className="rmlab-scene-footer"><span>REVLINE <i>/</i> MOTION LAB</span><span>{config.aspect === 'portrait' ? '09:16' : '16:09'}</span></footer>
  </div>;
}
