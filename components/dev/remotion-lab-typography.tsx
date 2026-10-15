import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Easing, interpolate, spring } from 'remotion';
import type { LabConfig } from './remotion-lab-model';
import type { LabExtraTextPreset } from './remotion-lab-text-presets';
import './remotion-lab-typography.css';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const bounded = (value: number) => Math.max(0, Math.min(1, value));
type TypeProps = { config: LabConfig; frame: number; preset: LabExtraTextPreset };
type Letter = { character: string; index: number };

function timing(config: LabConfig, frame: number, index = 0, count = 1, word = false) {
  const entrance = Math.min(config.entrance, config.duration * .4);
  const stagger = Math.min(config.textStagger * (word ? 3 : 1), Math.max(0, config.duration * .6 - entrance) / Math.max(1, count - 1));
  const elapsed = frame - index * stagger * config.fps;
  const duration = Math.max(1, Math.round(entrance * config.fps));
  const progress = interpolate(elapsed, [0, duration], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const bounce = elapsed < 0 ? 0 : spring({ frame: elapsed, fps: config.fps, durationInFrames: duration, config: { damping: config.damping, stiffness: config.stiffness, mass: .8 } });
  return { elapsed, duration, progress, bounce, visible: elapsed >= 0 };
}

function Words({ text, render }: { text: string; render: (word: string, index: number, count: number) => ReactNode }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return <>{words.map((word, index) => <Fragment key={index}>{render(word, index, words.length)}{index < words.length - 1 ? ' ' : null}</Fragment>)}</>;
}

function Letters({ text, render }: { text: string; render: (letter: Letter, count: number) => ReactNode }) {
  let cursor = 0;
  const count = Array.from(text.replace(/\s/g, '')).length;
  return <Words text={text} render={word => <span className="rmlab-extra-word">{Array.from(word).map(character => { const index = cursor++; return <Fragment key={index}>{render({ character, index }, count)}</Fragment>; })}</span>}/>;
}

function FlipWords({ config, frame }: TypeProps) {
  return <Words text={config.title} render={(word, index, count) => {
    const t = timing(config, frame, index, count, true), rotation = (1 - t.bounce) * -95 * config.textStrength;
    return <span className="rmlab-extra-word rmlab-flip-word" style={{ opacity: bounded(t.progress * 3), transform: `perspective(700px) translateY(${(1 - t.bounce) * 40 * config.textStrength}px) rotateX(${rotation}deg)`, textShadow: `0 ${Math.max(0, 1 - t.progress) * 13}px 18px #0003` }}>{word}</span>;
  }}/>;
}

function LineWipe({ config, frame }: TypeProps) {
  const words = config.title.trim().split(/\s+/).filter(Boolean), perLine = config.aspect === 'portrait' ? 2 : Math.max(2, Math.ceil(words.length / 2));
  const lines = Array.from({ length: Math.ceil(words.length / perLine) }, (_, index) => words.slice(index * perLine, (index + 1) * perLine).join(' '));
  return <span className="rmlab-wipe-lines">{lines.map((line, index) => {
    const t = timing(config, frame, index, lines.length, true);
    return <span className="rmlab-wipe-line" key={index}><span style={{ transform: `translateY(${(1 - t.progress) * 115}%) rotate(${(1 - t.progress) * -3 * config.textStrength}deg)`, opacity: t.visible ? 1 : 0 }}>{line}</span><i style={{ transform: `scaleX(${t.progress})`, opacity: Math.sin(t.progress * Math.PI) * .9 }}/></span>;
  })}</span>;
}

function ElasticWave({ config, frame }: TypeProps) {
  return <Letters text={config.title} render={({ character, index }, count) => {
    const t = timing(config, frame, index, count);
    const wave = Math.sin(frame / config.fps * 3.2 - index * .5) * 9 * config.textStrength * t.progress;
    const tilt = Math.cos(frame / config.fps * 3.2 - index * .5) * 4 * config.textStrength * t.progress;
    return <span className="rmlab-extra-letter" style={{ opacity: bounded(t.progress * 3), transform: `translateY(${(1 - t.bounce) * 55 * config.textStrength + wave}px) rotate(${tilt}deg) scaleY(${1 + Math.sin(index * .5 - frame / config.fps * 3.2) * .045 * config.textStrength * t.progress})` }}>{character}</span>;
  }}/>;
}

function RgbSplit({ config, frame }: TypeProps) {
  return <Words text={config.title} render={(word, index, count) => {
    const t = timing(config, frame, index, count, true);
    const split = (1 - t.progress) * 27 * config.textStrength;
    const jitter = Math.sin(t.elapsed * 2.3) * split * .3;
    return <span className="rmlab-extra-word rmlab-rgb-word" style={{ opacity: bounded(t.progress * 4), transform: `scale(${.9 + t.progress * .1})` }}><span className="rmlab-type-copy" style={{ color: config.accent, transform: `translate(${split + jitter}px,${-split * .15}px)`, opacity: (1 - t.progress) * .85 }}>{word}</span><span className="rmlab-type-copy" style={{ color: '#ff598b', transform: `translate(${-split + jitter}px,${split * .15}px)`, opacity: (1 - t.progress) * .85 }}>{word}</span><span style={{ position: 'relative', textShadow: `${split * .15}px 0 ${config.accent},${-split * .15}px 0 #ff598b` }}>{word}</span></span>;
  }}/>;
}

function TypeTrails({ config, frame }: TypeProps) {
  const t = timing(config, frame);
  const styleAt = (sample: number): CSSProperties => {
    const sampleTime = timing(config, sample);
    return { transform: `translate(${(1 - sampleTime.progress) * -125 * config.textStrength}px,${(1 - sampleTime.progress) * 38 * config.textStrength}px) skewX(${(1 - sampleTime.progress) * 12}deg)`, opacity: bounded(sampleTime.progress * 4) };
  };
  return <span className="rmlab-trails-stack">{[5, 4, 3, 2, 1].map(index => <span className="rmlab-trail-copy" key={index} style={{ ...styleAt(frame - index * (2 + config.textStagger * config.fps)), color: 'transparent', WebkitTextStroke: `${Math.max(.5, 1.2 - index * .12)}px ${config.accent}`, opacity: bounded(t.progress * 4) * (1 - t.progress) * (1 - index * .1) }}>{config.title}</span>)}<span className="rmlab-trail-fill" style={styleAt(frame)}>{config.title}</span></span>;
}

function LiquidStretch({ config, frame }: TypeProps) {
  return <Words text={config.title} render={(word, index, count) => {
    const t = timing(config, frame, index, count, true), elastic = (1 - t.bounce) * config.textStrength;
    return <span className="rmlab-extra-word rmlab-liquid-word" style={{ opacity: bounded(t.progress * 3), transform: `translateY(${elastic * 18}px) scale(${Math.max(.2, 1 + elastic * .65)},${Math.max(.12, 1 - elastic * .8)}) skewX(${elastic * -15}deg)`, filter: `blur(${Math.max(0, 1 - t.progress) * 2}px)`, color: index % 2 ? config.accent : config.foreground }}>{word}</span>;
  }}/>;
}

function BlurFocus({ config, frame }: TypeProps) {
  return <Words text={config.title} render={(word, index, count) => {
    const t = timing(config, frame, index, count, true);
    return <span className="rmlab-extra-word rmlab-focus-word" style={{ opacity: t.progress, filter: `blur(${(1 - t.progress) * 22 * config.textStrength}px)`, transform: `translateY(${(1 - t.progress) * 12}px) scale(${1.16 - t.progress * .16})`, letterSpacing: `${(1 - t.progress) * .18 * config.textStrength}em` }}>{word}</span>;
  }}/>;
}

function StampImpact({ config, frame }: TypeProps) {
  const t = timing(config, frame), impact = bounded(t.elapsed / Math.max(1, t.duration * .35));
  const afterImpact = Math.max(0, t.elapsed - t.duration * .35);
  const shake = Math.sin(afterImpact * 2.6) * Math.exp(-afterImpact / (config.fps * .1)) * 8 * config.textStrength;
  const scale = t.elapsed < t.duration * .35 ? 2.1 - impact * 1.15 : 1 - Math.exp(-afterImpact / (config.fps * .12)) * Math.cos(afterImpact / 2) * .05 * config.textStrength;
  const ring = bounded(afterImpact / Math.max(1, config.fps * config.entrance));
  return <span className="rmlab-stamp"><i className="rmlab-stamp-ring" style={{ opacity: t.elapsed >= t.duration * .35 ? (1 - ring) * .5 : 0, transform: `scale(${.7 + ring * 1.8 * config.textStrength})`, borderColor: config.accent }}/><span style={{ display: 'inline-block', opacity: bounded(t.progress * 3), transform: `translate(${shake}px,${shake * -.5}px) scale(${scale}) rotate(${(1 - impact) * -9 * config.textStrength}deg)`, textShadow: `${Math.max(0, 1 - impact) * 8}px ${Math.max(0, 1 - impact) * 8}px 0 ${config.accent}` }}>{config.title}</span></span>;
}

function DiagonalStagger({ config, frame }: TypeProps) {
  return <Words text={config.title} render={(word, index, count) => {
    const t = timing(config, frame, index, count, true), remaining = 1 - t.bounce;
    return <span className="rmlab-cascade-mask"><span className="rmlab-extra-word" style={{ opacity: bounded(t.progress * 4), transform: `translate(${remaining * -90 * config.textStrength}px,${remaining * 85 * config.textStrength}px) rotate(${remaining * -14 * config.textStrength}deg)`, color: index === count - 1 ? config.accent : config.foreground }}>{word}</span></span>;
  }}/>;
}

function CharacterScramble({ config, frame }: TypeProps) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return <Letters text={config.title} render={({ character, index }, count) => {
    const t = timing(config, frame, index, count);
    const resolved = t.progress >= .995;
    const tick = Math.floor(Math.max(0, t.elapsed) / Math.max(1, 3 - config.textStrength));
    const glyph = /[\p{L}\p{N}]/u.test(character) && !resolved ? alphabet[(index * 17 + tick * 13 + 7) % alphabet.length] : character;
    return <span className="rmlab-scramble-slot" style={{ opacity: bounded(t.progress * 4), color: resolved ? config.foreground : config.accent }}><span className="rmlab-scramble-width">{character}</span><span className="rmlab-scramble-glyph" style={{ transform: `translateY(${resolved ? 0 : Math.sin(tick * 2.4 + index) * 5 * config.textStrength}px)` }}>{glyph}</span></span>;
  }}/>;
}

/** Lab-only treatments use the supplied composition frame; there is no second clock. */
export function RemotionLabTypography(props: TypeProps) {
  const { config, frame, preset } = props;
  const longest = Math.max(1, ...config.title.split(/\s+/).map(word => Array.from(word).length));
  const fontSize = Math.min(config.textSize, (config.aspect === 'portrait' ? 420 : 780) / (longest * .64));
  const content = preset === 'flip-words' ? <FlipWords {...props}/> : preset === 'line-wipe' ? <LineWipe {...props}/> : preset === 'elastic-wave' ? <ElasticWave {...props}/> : preset === 'rgb-split' ? <RgbSplit {...props}/> : preset === 'type-trails' ? <TypeTrails {...props}/> : preset === 'liquid-stretch' ? <LiquidStretch {...props}/> : preset === 'blur-focus' ? <BlurFocus {...props}/> : preset === 'stamp-impact' ? <StampImpact {...props}/> : preset === 'diagonal-stagger' ? <DiagonalStagger {...props}/> : <CharacterScramble {...props}/>;
  return <span className="rmlab-extra-type" role="img" aria-label={config.title} data-lab-text={preset} data-frame={frame} style={{ color: config.foreground, fontSize, '--type-accent': config.accent } as CSSProperties}><span aria-hidden="true">{content}</span></span>;
}
