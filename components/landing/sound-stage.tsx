'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioLines, Play, Square } from 'lucide-react';

// Seconds of timeline the stage shows.
const LENGTH = 5;
// A clip is drawn at least this long so its name fits; its waveform still spans the real sound.
const MIN_WIDTH = .62;

// Sound effects Revline generated (ElevenLabs), each placed on the move it scores.
const sounds = [
  { name: 'Soft whoosh', file: 'whoosh', at: .2 },
  { name: 'Glass tick', file: 'tick', at: 1.45 },
  { name: 'Paper rip', file: 'rip', at: 2.35 },
  { name: 'Deep boom', file: 'boom', at: 3.15 },
];
type Sound = typeof sounds[number];

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
    // Decoding needs no output device, so a suspended context is enough until someone presses play.
    const ctx = audio.current ??= new AudioContext();
    void Promise.all(sounds.map(sound => fetch(`/landing/sounds/${sound.file}.m4a`).then(response => response.arrayBuffer()).then(data => ctx.decodeAudioData(data)))).then(decoded => {
      if (cancelled) return;
      buffers.current = decoded;
      setPeaks(decoded.map(buffer => peaksOf(buffer, Math.round(Math.max(buffer.duration, MIN_WIDTH) * 56))));
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
    const to = only ? only.at + buffers.current[sounds.indexOf(only)].duration : LENGTH;
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
      <div className="landing-sound-ruler" aria-hidden="true">{[0, 1, 2, 3, 4].map(second => <span key={second} style={{ left: percent(second) }}>{second}s</span>)}</div>
      <div className="landing-sound-track">
        {sounds.map((sound, index) => {
          const duration = buffers.current[index]?.duration ?? MIN_WIDTH;
          const progress = playhead === null ? 0 : Math.min(1, Math.max(0, (playhead - sound.at) / duration));
          return <button key={sound.name} type="button" className="landing-sound-clip" style={{ left: percent(sound.at), width: percent(Math.max(duration, MIN_WIDTH)) }} onClick={() => play(sound)} disabled={!peaks} aria-label={`Play ${sound.name}`}>
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
