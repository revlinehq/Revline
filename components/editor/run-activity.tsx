'use client';

import { useState, type CSSProperties } from 'react';
import { AlertTriangle, Check, CircleCheck, CircleStop, LoaderCircle, Minus } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { toolImages } from './assistant-results';
import { assistantErrorDetail } from './assistant-turn-presentation';
import { runWords, type RunStep } from './assistant-run';

type Frame = { label: string; src: string; /** Where this frame sits on a contact sheet: its index among `of` tiles. */ tile?: { index: number; of: number } };
type Row = { key: string; tool: string; plain: boolean; detail: string; state: RunStep['state']; reason?: string; count: number; frames: Frame[]; sheet: boolean };

/** Reads that look at frames; only these show a picture in the chat. */
const FRAME_TOOLS = new Set(['getFrames', 'readFrames', 'inspectFrames']);

const short = (value: string, length = 28) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A timeline or source second as the editor shows it: 0:12, or 0:12.5 between whole seconds. */
export function timecode(seconds: number) {
  const tenths = Math.round(seconds * 10), whole = Math.floor(tenths / 10), tenth = tenths % 10;
  const base = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  return tenth ? `${base}.${tenth}` : base;
}
const range = (from: number, to: number) => Math.abs(to - from) < .05 ? timecode(from) : `${timecode(from)}–${timecode(to)}`;
/** "12.000s" anywhere in a label reads as 0:12. */
const timecodes = (text: string) => text.replace(/(\d+(?:\.\d+)?)\s?s\b/g, (_, value: string) => timecode(Number(value)));

/** The muted hint after a step's label, from the tool's own input: the time it covered, its text, or how many clips. Never IDs. */
function detailOf(step: RunStep) {
  const input = step.input ?? {};
  const times = Array.isArray(input.times) ? input.times.filter(finite) : [];
  // getFrames scans a stretch as range: { start, end }.
  const span = input.range && typeof input.range === 'object' ? input.range as Record<string, unknown> : input;
  const start = [span.start, input.time, input.at].find(finite);
  const time = times.length ? range(Math.min(...times), Math.max(...times))
    : start !== undefined ? range(start, finite(span.end) ? span.end : finite(input.duration) ? start + input.duration : start) : undefined;
  const text = ['title', 'text', 'look', 'preset', 'animation', 'mode', 'name'].map(key => input[key]).find((value): value is string => typeof value === 'string' && !!value.trim());
  const clips = Array.isArray(input.clipIds) && input.clipIds.length > 1 ? `${input.clipIds.length} clips` : undefined;
  return [time, text ? short(text) : undefined, time && text ? undefined : clips].filter(Boolean).slice(0, 2).join(' · ');
}

/** The frames a frame read returned, each with its timecode. A contact sheet is one image for several times. */
function framesOf(step: RunStep): { frames: Frame[]; sheet: boolean } {
  const images = toolImages(step);
  if (!images.length) return { frames: [], sheet: false };
  // getFrames names its times once, in the text before its images: "One contact sheet of N frames … : 12.000s, 12.500s."
  // or "… frames of the saved timeline at 12.000s, 13.000s, in that order." Times are always written to the millisecond.
  const value = step.output?.type === 'content' && Array.isArray(step.output.value) ? step.output.value : [];
  const first = value.find((part): part is { type: 'text'; text: string } => !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string');
  const listed = step.name === 'getFrames' && first ? /(?:labeled with its time: | at )((?:\d+\.\d{3}s(?:, )?)+)/.exec(first.text)?.[1] ?? '' : '';
  const times = [...listed.matchAll(/(\d+\.\d{3})s/g)].map(match => Number(match[1]));
  // A contact sheet of several times: each tile is shown as its own frame, cut from the sheet.
  const unique = [...new Set(times.map(time => time.toFixed(3)))].map(Number);
  if (images.length === 1 && unique.length > 1 && first?.text.startsWith('One contact sheet')) return { frames: unique.map((time, index) => ({ src: images[0].src, label: timecode(time), tile: { index, of: unique.length } })), sheet: false };
  const sheet = images.length === 1 && step.name === 'readFrames' && !(finite(step.input?.count) && step.input.count === 1);
  return { frames: images.map((image, index) => ({ src: image.src, label: image.label ? timecodes(image.label) : finite(times[index]) ? timecode(times[index]) : '' })), sheet };
}

/** One row per step; consecutive successful calls of the same tool fold into ×N. Frame reads always keep their own row. */
function stepRows(steps: RunStep[]): Row[] {
  const rows: Row[] = [];
  for (const step of steps) {
    const frameRead = !step.plain && FRAME_TOOLS.has(step.name);
    const detail = step.plain ? '' : detailOf(step), previous = rows.at(-1);
    if (!frameRead && previous && !previous.frames.length && !FRAME_TOOLS.has(previous.tool) && previous.tool === step.name && previous.state === 'done' && step.state === 'done') {
      previous.count++;
      if (previous.detail !== detail) previous.detail = '';
      continue;
    }
    const { frames, sheet } = frameRead && step.state === 'done' ? framesOf(step) : { frames: [], sheet: false };
    rows.push({ key: step.key, tool: step.name, plain: !!step.plain, detail, state: step.state, reason: step.state === 'error' ? step.detail || assistantErrorDetail(undefined) : undefined, count: 1, frames, sheet });
  }
  return rows;
}

/** The layout lib/server/read-reference.ts `sheet` draws: tiles `across` to a row, 8 px apart, each with a 30 px label
 * strip under it. getFrames puts 4 across for landscape frames and 6 for portrait ones (review-composition.ts). Tiles are
 * whole pixels, so the layout is the one whose tiles come out whole and the matching shape; either size can fit a sheet. */
type Sheet = { width: number; height: number; columns: number; tileWidth: number; tileHeight: number };
const GAP = 8, LABEL = 30;
function sheetLayout(width: number, height: number, count: number): Sheet | null {
  const layouts = [4, 6].flatMap(across => {
    const columns = Math.min(across, count), rows = Math.ceil(count / columns);
    const tileWidth = (width - GAP * (columns + 1)) / columns, tileHeight = (height - GAP - rows * (LABEL + GAP)) / rows;
    return tileWidth > 0 && tileHeight > 0 && (across === 4) === (tileWidth >= tileHeight) ? [{ width, height, columns, tileWidth, tileHeight }] : [];
  });
  const whole = (value: number) => Math.abs(value - Math.round(value)) < .01;
  return layouts.find(layout => whole(layout.tileWidth) && whole(layout.tileHeight)) ?? layouts[0] ?? null;
}
/** One tile of a contact sheet, cropped by placing the whole sheet behind a tile-sized window. */
function tileStyle(sheet: Sheet, index: number): CSSProperties {
  const left = GAP + (index % sheet.columns) * (sheet.tileWidth + GAP), top = GAP + Math.floor(index / sheet.columns) * (sheet.tileHeight + LABEL + GAP);
  return { width: `${sheet.width / sheet.tileWidth * 100}%`, left: `${-left / sheet.tileWidth * 100}%`, top: `${-top / sheet.tileHeight * 100}%` };
}

/** The frames a read looked at, in a grid under its row: six to a line, timecode underneath. Click for full size. */
function FrameGrid({ frames, sheet }: { frames: Frame[]; sheet: boolean }) {
  const [open, setOpen] = useState<Frame | null>(null);
  // Columns follow the frames' shape: six portrait frames fit the chat width, landscape ones go four to a line.
  const [loadedLandscape, setLandscape] = useState(false);
  // A contact sheet's layout comes from its size once the first tile has loaded (lazily, like any frame); until then the
  // tiles hold their place. A sheet that does not load or match the layout shows whole instead.
  const [tiles, setTiles] = useState<Sheet | 'whole' | null>(null);
  if (tiles === 'whole' && frames[0]?.tile) return <FrameGrid frames={[{ src: frames[0].src, label: `${frames[0].label}–${frames.at(-1)!.label}` }]} sheet/>;
  const layout = tiles && tiles !== 'whole' ? tiles : null;
  const landscape = frames[0]?.tile ? !!layout && layout.tileWidth > layout.tileHeight : loadedLandscape;
  return <div className={`run-frame-grid${landscape ? ' is-landscape' : ''}${sheet ? ' is-sheet' : ''}`}>
    {frames.map((frame, index) => <button key={index} type="button" className="run-frame" onClick={() => setOpen(frame)} aria-label={`Open frame${frame.label ? ` at ${frame.label}` : ''}`}>
      {frame.tile
        // eslint-disable-next-line @next/next/no-img-element
        ? <span className="run-frame-tile" style={layout ? { aspectRatio: `${layout.tileWidth} / ${layout.tileHeight}` } : undefined}><img className="run-frame-crop" src={frame.src} alt={frame.label} loading="lazy" style={layout ? tileStyle(layout, frame.tile.index) : { visibility: 'hidden' }} onLoad={event => { if (!layout) { const count = frame.tile!.of, image = event.currentTarget; setTiles(sheetLayout(image.naturalWidth, image.naturalHeight, count) ?? 'whole'); } }} onError={() => setTiles('whole')}/></span>
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={frame.src} alt={frame.label} loading="lazy" onLoad={event => { if (index === 0 && !sheet) setLandscape(event.currentTarget.naturalWidth > event.currentTarget.naturalHeight); }}/>}
      {frame.label && <span>{frame.label}</span>}
    </button>)}
    <Dialog open={!!open} onOpenChange={value => { if (!value) setOpen(null); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <DialogContent className="run-step-image-dialog"><DialogTitle>{open?.label || 'Frame'}</DialogTitle>{open && <img src={open.src} alt={open.label}/>}</DialogContent>
    </Dialog>
  </div>;
}

/** One step on one line: a mark for its state, what it did in plain words, and a muted hint. */
function StepRow({ row }: { row: Row }) {
  const words = row.plain ? [row.tool, row.tool] as const : runWords(row.tool);
  const Mark = row.state === 'running' ? LoaderCircle : row.state === 'error' ? AlertTriangle : row.state === 'stopped' ? Minus : Check;
  return <div className="run-step" data-state={row.state}>
    <div className="run-step-line">
      <Mark className={`run-step-mark${row.state === 'running' ? ' animate-spin' : ''}`} aria-label={row.state === 'running' ? 'Running' : row.state === 'error' ? 'Failed' : row.state === 'stopped' ? 'Stopped' : 'Done'}/>
      <span className="run-step-label">{row.state === 'done' ? words[1] : words[0]}</span>
      {(row.detail || row.count > 1 || row.state === 'stopped') && <span className="run-step-detail">{[row.detail, row.count > 1 ? `×${row.count}` : '', row.state === 'stopped' ? 'stopped' : ''].filter(Boolean).join(' · ')}</span>}
    </div>
    {row.reason && <p className="run-step-reason">{row.reason}</p>}
    {row.frames.length > 0 && <FrameGrid frames={row.frames} sheet={row.sheet}/>}
  </div>;
}

/** The run's steps: "Ran N steps" (or "Running N steps" while live) with a plain row per step under a thin rule.
 * Open by default; the heading folds it. */
export function RunSteps({ steps, active }: { steps: RunStep[]; active: boolean }) {
  const [open, setOpen] = useState(true);
  if (!steps.length) return null;
  const failed = steps.filter(step => step.state === 'error').length, stopped = !active && steps.some(step => step.state === 'stopped');
  const Status = active ? LoaderCircle : failed ? AlertTriangle : stopped ? CircleStop : CircleCheck;
  const n = `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
  return <Collapsible className="run-steps" open={open} onOpenChange={setOpen}>
    <CollapsibleTrigger className="run-steps-heading" data-tone={active ? 'running' : failed ? 'error' : stopped ? 'stopped' : 'done'}>
      <Status className={`run-steps-mark${active ? ' animate-spin' : ''}`} aria-hidden="true"/>
      <span>{active ? `Running ${n}` : stopped ? `Stopped after ${n}` : `Ran ${n}`}</span>
      {failed > 0 && <span className="run-step-detail">{failed} failed</span>}
    </CollapsibleTrigger>
    <CollapsibleContent className="run-step-list" aria-label="Assistant steps">
      {stepRows(steps).map(row => <StepRow key={row.key} row={row}/>)}
    </CollapsibleContent>
  </Collapsible>;
}
