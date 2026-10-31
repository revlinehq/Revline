'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioLines, Play, Square } from 'lucide-react';

// Seconds of timeline the stage shows.
const LENGTH = 5;
const SAMPLE_RATE = 44100;

type Sound = { name: string; at: number; duration: number; build: (ctx: OfflineAudioContext, noise: AudioBuffer) => void };

/** Seeded white noise, so every visitor hears and sees the same sounds. */
function makeNoise(ctx: BaseAudioContext, seconds: number) {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 7;
  for (let index = 0; index < data.length; index++) {
    seed = (seed * 16807) % 2147483647;
    data[index] = seed / 1073741823.5 - 1;
  }
  return buffer;
}

function playNoise(ctx: OfflineAudioContext, noise: AudioBuffer) {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.start(0);
  return source;
}

// Each effect sits on the move it scores, synthesized in the browser so its waveform is the real sound.
const sounds: Sound[] = [
  { name: 'Soft whoosh', at: .2, duration: .9, build: (ctx, noise) => {
    const filter = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 1.1 });
    filter.frequency.setValueAtTime(250, 0);
    filter.frequency.exponentialRampToValueAtTime(2800, .5);
    filter.frequency.exponentialRampToValueAtTime(450, .9);
    const gain = new GainNode(ctx);
    gain.gain.setValueAtTime(.001, 0);
    gain.gain.exponentialRampToValueAtTime(1.6, .48);
    gain.gain.exponentialRampToValueAtTime(.001, .9);
    playNoise(ctx, noise).connect(filter).connect(gain).connect(ctx.destination);
  } },
  { name: 'Glass tick', at: 1.7, duration: .35, build: ctx => {
    for (const [frequency, level] of [[2200, .5], [3310, .3], [5400, .12]]) {
      const tone = new OscillatorNode(ctx, { frequency });
      const gain = new GainNode(ctx);
      gain.gain.setValueAtTime(level, 0);
      gain.gain.exponentialRampToValueAtTime(.0005, .34);
      tone.connect(gain).connect(ctx.destination);
      tone.start(0);
    }
  } },
  { name: 'Paper rip', at: 2.45, duration: .65, build: (ctx, noise) => {
    const filter = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1400 });
    const gain = new GainNode(ctx);
    let seed = 3;
    for (let step = 0; step < 48; step++) {
      seed = (seed * 16807) % 2147483647;
      const time = step * .65 / 48;
      const envelope = Math.min(1, step / 6) * (1 - step / 52);
      gain.gain.setValueAtTime(envelope * (.25 + .9 * seed / 2147483647), time);
    }
    gain.gain.setValueAtTime(0, .65);
    playNoise(ctx, noise).connect(filter).connect(gain).connect(ctx.destination);
  } },
  { name: 'Deep boom', at: 3.45, duration: 1.4, build: (ctx, noise) => {
    const tone = new OscillatorNode(ctx, { frequency: 120 });
    tone.frequency.exponentialRampToValueAtTime(36, 1.1);
    const body = new GainNode(ctx);
    body.gain.setValueAtTime(1, 0);
    body.gain.exponentialRampToValueAtTime(.001, 1.4);
    tone.connect(body).connect(ctx.destination);
    tone.start(0);
    const thump = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 260 });
    const hit = new GainNode(ctx);
    hit.gain.setValueAtTime(1.2, 0);
    hit.gain.exponentialRampToValueAtTime(.001, .18);
    playNoise(ctx, noise).connect(thump).connect(hit).connect(ctx.destination);
  } },
];

/** Bar heights (0 to 1) from the rendered audio: the loudest sample in each slice. */
function peaksOf(buffer: AudioBuffer, bars: number) {
  const data = buffer.getChannelData(0);
  const size = Math.floor(data.length / bars);
  const peaks = Array.from({ length: bars }, (_, bar) => {
    let peak = 0;
    for (let index = bar * size; index < (bar + 1) * size; index++) peak = Math.max(peak, Math.abs(data[index]));
    return peak;
  });
  const loudest = Math.max(...peaks) || 1;
  return peaks.map(peak => Math.max(.04, peak / loudest));
}

function Wave({ peaks }: { peaks: number[] }) {
  return <svg viewBox={`0 0 ${peaks.length * 3} 100`} preserveAspectRatio="none" aria-hidden="true">
    {peaks.map((peak, index) => <rect key={index} x={index * 3} y={50 - peak * 48} width={2} height={peak * 96} rx={1} />)}
  </svg>;
}

/** The sound feature's stage: a prompt, a cut and its generated effects, playable on the timeline. */
export function LandingSoundStage() {
  const [peaks, setPeaks] = useState<number[][] | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const buffers = useRef<AudioBuffer[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const playing = useRef<{ sources: AudioBufferSourceNode[]; frame: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(sounds.map(sound => {
      const ctx = new OfflineAudioContext(1, Math.ceil(sound.duration * SAMPLE_RATE), SAMPLE_RATE);
      sound.build(ctx, makeNoise(ctx, sound.duration));
      return ctx.startRendering();
    })).then(rendered => {
      if (cancelled) return;
      buffers.current = rendered;
      setPeaks(rendered.map((buffer, index) => peaksOf(buffer, Math.round(sounds[index].duration * 56))));
    });
    return () => { cancelled = true; stop(); };
  }, []);

  function stop() {
    if (!playing.current) return;
    cancelAnimationFrame(playing.current.frame);
    playing.current.sources.forEach(source => source.stop());
    playing.current = null;
    setPlayhead(null);
  }

  /** Plays the whole stage, or one effect when a clip is clicked. A second click stops. */
  function play(only?: Sound) {
    const wasPlaying = playing.current !== null;
    stop();
    if (wasPlaying && !only) return;
    const ctx = audio.current ??= new AudioContext();
    void ctx.resume();
    const from = only ? only.at : 0;
    const to = only ? only.at + only.duration : LENGTH;
    const start = ctx.currentTime + .05;
    const sources = sounds.flatMap((sound, index) => {
      if (only && sound !== only) return [];
      const source = new AudioBufferSourceNode(ctx, { buffer: buffers.current[index] });
      source.connect(ctx.destination);
      source.start(start + sound.at - from);
      return [source];
    });
    const tick = () => {
      const time = from + ctx.currentTime - start;
      if (time >= to) { stop(); return; }
      setPlayhead(Math.max(from, time));
      if (playing.current) playing.current.frame = requestAnimationFrame(tick);
    };
    playing.current = { sources, frame: requestAnimationFrame(tick) };
  }

  const percent = (seconds: number) => `${seconds / LENGTH * 100}%`;
  return <div className="landing-sound">
    <div className="landing-sound-head">
      <p className="landing-sound-prompt"><AudioLines size={15} aria-hidden="true" />Soft airy whoosh, passing left to right</p>
      <button type="button" className="landing-sound-play" onClick={() => play()} disabled={!peaks}>
        {playhead !== null ? <Square size={12} fill="currentColor" aria-hidden="true" /> : <Play size={13} fill="currentColor" aria-hidden="true" />}
        {playhead !== null ? 'Stop' : 'Play'}
      </button>
    </div>
    <div className="landing-sound-tracks">
      <div className="landing-sound-track" data-kind="video" aria-hidden="true">
        {[0, 1.2, 2.4, 3.6].map(at => <span key={at} style={{ left: percent(at), width: percent(1.15) }} />)}
      </div>
      <div className="landing-sound-track" data-kind="sfx">
        {sounds.map((sound, index) => {
          const progress = playhead === null ? 0 : Math.min(1, Math.max(0, (playhead - sound.at) / sound.duration));
          return <button key={sound.name} type="button" className="landing-sound-clip" style={{ left: percent(sound.at), width: percent(sound.duration) }} onClick={() => play(sound)} disabled={!peaks} aria-label={`Play ${sound.name}`}>
            <b>{sound.name}</b>
            {peaks && <span className="landing-sound-wave">
              <Wave peaks={peaks[index]} />
              <span className="landing-sound-wave-played" style={{ width: `${progress * 100}%` }}><span style={{ width: `${progress ? 100 / progress : 0}%` }}><Wave peaks={peaks[index]} /></span></span>
            </span>}
          </button>;
        })}
      </div>
      {sounds.map(sound => <i key={sound.name} className="landing-sound-cue" style={{ left: percent(sound.at) }} aria-hidden="true" />)}
      {playhead !== null && <i className="landing-sound-playhead" style={{ left: percent(playhead) }} aria-hidden="true" />}
    </div>
  </div>;
}
