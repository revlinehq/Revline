'use client';
import { useRef, useState } from 'react';
import type { ChatTool } from './assistant-results';
import './reference-card.css';

type Shot = { id: string; start: number; end: number; duration: number; transition: string; camera: string; onBeat?: boolean; description: string; parts: string[]; titles?: string[] };
type Signature = { id: string; kind: string; label: string; shotIds: string[] };
type Moment = { id: string; start: number; end: number; peak: number; kind: 'cut' | 'motion'; shotId: string };
export type ReferenceView = { assetId: string; fileName: string; genre: string; duration: number; shots: Shot[]; signatures: Signature[]; moments?: Moment[]; rhythm: { medianShot: number; cutsPerMinute: number; bpm?: number; onBeatRatio?: number } };
export type ReferenceMedia = { url: string | null; previewUrl?: string | null };

/** A finished reference breakdown (analyzeMedia mode reference); null for any other step. */
export function referenceOf(step: ChatTool): ReferenceView | null {
  const output = step.output;
  if (step.name !== 'analyzeMedia' || step.state !== 'done' || output?.mode !== 'reference' || !Array.isArray(output.shots) || !output.shots.length || typeof output.assetId !== 'string') return null;
  return output as unknown as ReferenceView;
}

const GENRES: Record<string, string> = { 'social-edit': 'Social edit', motivation: 'Motivation video', 'launch-film': 'Launch film', ad: 'Ad', 'music-video': 'Music video', vlog: 'Vlog', tutorial: 'Tutorial', other: 'Video' };
const seconds = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)}s`;

/** The reference shot by shot: play it, pick a shot, and add shots or parts to the next message. */
export function ReferenceCard({ view, media, onPick }: { view: ReferenceView; media?: ReferenceMedia; onPick?: (token: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [selected, setSelected] = useState(0);
  const [time, setTime] = useState(0);
  const source = media?.previewUrl ?? media?.url ?? undefined;
  const shot = view.shots[Math.min(selected, view.shots.length - 1)];
  const playing = view.shots.findIndex(item => time >= item.start && time < item.end);
  const choose = (index: number) => {
    setSelected(index);
    if (video.current) { video.current.currentTime = view.shots[index].start + Math.min(.05, view.shots[index].duration / 2); setTime(video.current.currentTime); }
  };
  const moments = view.moments ?? [], strongest = Math.max(...moments.map(item => item.peak), .01);
  const seek = (at: number) => { if (video.current) { video.current.currentTime = at; setTime(at); } };
  const rhythm = [`${view.shots.length} shots`, moments.length ? `${moments.length} moments` : '', `${seconds(view.rhythm.medianShot)} median`, view.rhythm.bpm ? `${view.rhythm.bpm} bpm` : '', view.rhythm.onBeatRatio !== undefined ? `${Math.round(view.rhythm.onBeatRatio * 100)}% cuts on the beat` : ''].filter(Boolean).join(' · ');
  const chip = (token: string, label = token) => <button key={token} type="button" className="reference-chip" disabled={!onPick} onClick={() => onPick?.(token)}>{label}</button>;
  return <section className="reference-card" aria-label={`Reference breakdown of ${view.fileName}`}>
    <header className="reference-card-head">
      <strong>{GENRES[view.genre] ?? GENRES.other}</strong>
      <span>{rhythm}</span>
    </header>
    {source && <video ref={video} className="reference-card-video" src={source} muted playsInline controls preload="metadata" onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onSeeked={event => { const now = event.currentTarget.currentTime, index = view.shots.findIndex(item => now >= item.start && now < item.end); setTime(now); if (index >= 0) setSelected(index); }} />}
    <div className="reference-bar">
    <div className="reference-strip" role="listbox" aria-label="Shots">
      {view.shots.map((item, index) => <button key={item.id} type="button" role="option" aria-selected={index === selected} className={`reference-shot${index === playing ? ' is-playing' : ''}`} style={{ flexGrow: item.duration }} onClick={() => choose(index)} aria-label={`${item.id}, ${seconds(item.start)} to ${seconds(item.end)}`}>
        <span>{item.id}</span>
      </button>)}
    </div>
    {/* Moments over the shots: everything that changes, motion inside a shot as well as cuts. Taller marks moved more. */}
    {moments.length > 0 && <div className="reference-moments" aria-label="Moments">
      {moments.map(item => <button key={item.id} type="button" className={`reference-moment is-${item.kind}`} title={`${item.id} · ${item.kind} · ${seconds(item.start)} to ${seconds(item.end)}`} aria-label={`${item.id}, ${item.kind}, ${seconds(item.start)} to ${seconds(item.end)}`} style={{ left: `${item.start / view.duration * 100}%`, width: `${Math.max(0, item.end - item.start) / view.duration * 100}%`, '--strength': .35 + .65 * item.peak / strongest } as React.CSSProperties} onClick={() => { const index = view.shots.findIndex(shot => shot.id === item.shotId); if (index >= 0) setSelected(index); seek(item.start); }}/>)}
    </div>}
    </div>
    <div className="reference-detail">
      <p className="reference-detail-meta">{shot.id} · {seconds(shot.start)} to {seconds(shot.end)} · {shot.transition === 'cut' ? 'hard cut in' : `${shot.transition} in`} · {shot.camera}{shot.onBeat ? ' · on the beat' : ''}</p>
      <p className="reference-detail-text">{shot.description}</p>
      <div className="reference-chips">
        {chip(shot.id)}
        {shot.transition !== 'cut' && chip(`${shot.id} transition`, `transition: ${shot.transition}`)}
        {shot.camera !== 'static' && shot.camera !== 'other' && chip(`${shot.id} camera`, `camera: ${shot.camera}`)}
        {shot.parts.map(part => chip(part))}
        {!!shot.titles?.length && !shot.parts.some(part => part.startsWith(`${shot.id}.title`)) && chip(`${shot.id} title`, 'title')}
        {moments.filter(item => item.shotId === shot.id).map(item => chip(`${shot.id} @ ${item.start.toFixed(1)}s`, `${item.id} ${item.kind} ${seconds(item.start)}`))}
        {source && chip(`${view.shots[playing]?.id ?? shot.id} @ ${time.toFixed(1)}s`, 'this moment')}
      </div>
    </div>
    {view.signatures.length > 0 && <div className="reference-chips reference-signatures" aria-label="Signature moves">
      {view.signatures.map(signature => chip(signature.id, `${signature.id} ${signature.label}`))}
    </div>}
  </section>;
}
