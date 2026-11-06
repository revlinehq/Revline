import { Clapperboard } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { FilmDraftView } from '@/lib/editor/film-draft-view';
import './film-draft.css';

/** The header of the "Drafting film…" row above A1. */
export function FilmDraftLabel({ draft, height }: { draft: FilmDraftView; height: number }) {
  return <div className="track-label film-draft-label" data-group="draft" style={{ height }} title={`Drafting ${draft.title}`}>
    <span className="track-label-name film-draft-shimmer">Drafting film…</span>
  </div>;
}

/** The film the editor agent is still writing: finished sections as blocks, the one being written shimmering, the rest as
 * placeholders. It is display only; the saved film replaces it when the tool call lands. */
export function FilmDraftTrack({ draft, height, px, origin }: { draft: FilmDraftView; height: number; px: number; origin: number }) {
  const at = (start: number) => origin + (draft.start + start) * px, width = (duration: number) => Math.max(6, duration * px);
  return <div className="timeline-track film-draft-track" data-group="draft" style={{ height }} aria-label={`Drafting ${draft.title}`} aria-live="polite">
    <div className="film-draft-span film-draft-shimmer" style={{ left: at(0), width: width(draft.duration) }} aria-hidden="true"/>
    {draft.planned.map(section => <Skeleton key={`planned:${section.start}`} className="film-draft-placeholder animate-none" style={{ left: at(section.start), width: width(section.duration) }}/>)}
    {draft.sections.map(section => <div key={`done:${section.start}`} className="film-draft-block" style={{ left: at(section.start), width: width(section.duration) }} title={`${section.title} · ${section.duration.toFixed(1)}s`}>
      <span className="clip-title"><Clapperboard size={12} aria-hidden="true"/><span className="clip-name">{section.title}</span><small>{section.duration.toFixed(1)}s</small></span>
    </div>)}
    {draft.writing && <div className="film-draft-block film-draft-shimmer" data-writing style={{ left: at(draft.writing.start), width: width(draft.writing.duration) }} title={`Writing ${draft.writing.title}`}>
      <span className="clip-title"><Clapperboard size={12} aria-hidden="true"/><span className="clip-name">{draft.writing.title}</span><small>{draft.writing.duration.toFixed(1)}s</small></span>
    </div>}
  </div>;
}
