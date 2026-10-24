'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { AlertTriangle, AudioLines, BookOpen, Captions, ChevronDown, Clapperboard, Crop, Eye, Film, Gauge, Layers, ListChecks, ListTree, LoaderCircle, Music, ScanSearch, Scissors, Type, Undo2, Volume2, WandSparkles } from 'lucide-react';
import type { ChatTool } from './assistant-results';

type Row = { key: string; tool: string; args: string; icon: ComponentType<{ size?: number; className?: string }>; state: ChatTool['state']; count: number };

const ICON_GROUPS: [ComponentType<{ size?: number; className?: string }>, string[]][] = [
  [BookOpen, ['readSkill']],
  [ListTree, ['inspectTimeline']],
  [ScanSearch, ['inspectClip', 'inspectVideo', 'inspectFrames', 'inspectVideoFrames', 'inspectAssetAnalysis']],
  [AudioLines, ['analyzeMedia']],
  [ListChecks, ['planEffects']],
  [Eye, ['previewRender']],
  [Clapperboard, ['addScene', 'editScene']],
  [Captions, ['addCaption', 'addSubtitlesFromTranscript', 'styleCaptions', 'applyCaptionStyle', 'setCaptionTiming']],
  [Type, ['addGraphic', 'editText', 'styleTextClip', 'setTextGradient', 'setTextStyle', 'applyTextLook', 'setTextAnimation', 'applyTextTemplate', 'configureTextTemplate']],
  [Scissors, ['split', 'trim', 'delete', 'retainSourceRanges', 'resizeClips', 'useStrongestMoment', 'alignCutsToBeat']],
  [Crop, ['transformClip', 'cropClip', 'fitClip', 'resetVisual', 'applyLayout', 'setAspectRatio', 'followSubject', 'configureSmoothZoom', 'configureCameraMotion']],
  [Film, ['addMedia', 'duplicateClips', 'move', 'moveClips', 'unlink']],
  [Layers, ['addLayer', 'deleteEmptyLayer', 'removeEmptyLayers', 'reorderLayer']],
  [Music, ['markMusicBeats', 'addMarker', 'moveMarker', 'removeMarker', 'removeMarkers']],
  [Volume2, ['configureAudio', 'setVolume']],
  [Gauge, ['setPlaybackRate']],
  [Undo2, ['undoLatestEdit']],
];
const ICONS = new Map(ICON_GROUPS.flatMap(([icon, names]) => names.map(name => [name, icon] as const)));

const short = (value: string, length = 32) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const seconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${Number(value.toFixed(2))}s` : undefined;

/** A short human hint from a tool's own input; never IDs or error text. */
function argumentsOf(step: ChatTool) {
  const input = step.input ?? {};
  const text = (key: string) => typeof input[key] === 'string' && input[key] ? short(String(input[key])) : undefined;
  if (step.name === 'readSkill') return text('name') ?? '';
  const parts = [text('title') ?? text('text') ?? text('look') ?? text('preset') ?? text('animation') ?? text('mode') ?? text('question'), seconds(input.start) ?? seconds(input.time) ?? seconds(input.at), seconds(input.duration)];
  const ids = Array.isArray(input.clipIds) ? input.clipIds.length : 0;
  if (ids > 1) parts.push(`${ids} clips`);
  return parts.filter(Boolean).join(' · ');
}

/** One row per tool call in order; identical consecutive calls fold into ×N. */
export function toolChainRows(steps: ChatTool[]): Row[] {
  const rows: Row[] = [];
  steps.forEach((step, index) => {
    const args = argumentsOf(step), previous = rows.at(-1);
    if (previous && previous.tool === step.name && previous.args === args && previous.state === step.state && step.state === 'done') { previous.count++; return; }
    // Raw tool errors can carry backend internals; the turn's failure card explains them.
    rows.push({ key: step.id ?? `${step.name}-${index}`, tool: step.name, args, icon: ICONS.get(step.name) ?? WandSparkles, state: step.state, count: 1 });
  });
  return rows;
}

/** The assistant's steps as a tree. It stays open while the turn runs and collapses when it ends. */
export function ToolChain({ steps, running }: { steps: ChatTool[]; running: boolean }) {
  const rows = toolChainRows(steps);
  const [open, setOpen] = useState(running);
  useEffect(() => { setOpen(running); }, [running]);
  if (!rows.length) return null;
  const skill = steps.find(step => step.name === 'readSkill' && typeof step.input?.name === 'string')?.input?.name as string | undefined;
  const label = running ? 'Working on your edit' : skill ? `Used ${skill}` : 'Edited timeline';
  return <div className="tool-chain" data-open={open || undefined}>
    <button type="button" className="tool-chain-root" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="tool-chain-label">{label}</span>
      <span className="tool-chain-count">{rows.length} {rows.length === 1 ? 'step' : 'steps'}</span>
      <ChevronDown size={13} className="tool-chain-chevron" aria-hidden/>
    </button>
    {open && <ol className="tool-chain-rows" aria-label="Assistant steps">
      {rows.map((row, index) => {
        const Icon = row.state === 'error' ? AlertTriangle : row.icon;
        return <li key={row.key} className={`tool-chain-row state-${row.state}${index === rows.length - 1 ? ' is-last' : ''}`}>
          <span className="tool-chain-branch" aria-hidden><span className="tool-chain-stem"/><span className="tool-chain-elbow"/></span>
          <Icon size={13} className="tool-chain-icon"/>
          <span className="tool-chain-text"><span className="tool-chain-tool">{row.tool}</span>{(row.args || row.count > 1) && <span className="tool-chain-args">{row.args}{row.count > 1 ? `${row.args ? ' ' : ''}×${row.count}` : ''}</span>}</span>
          {row.state === 'running' && <span className="tool-chain-status">Running<LoaderCircle size={12} className="animate-spin" aria-hidden/></span>}
          {row.state === 'error' && <span className="tool-chain-status">Failed</span>}
        </li>;
      })}
    </ol>}
  </div>;
}
