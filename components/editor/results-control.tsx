'use client';
// The "Results" choice in the composer's bottom row: show finished clips in the chat, or open the full editor.
import { GalleryVertical } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { decodeResultsView, resultsViewKey, type ResultsView } from '@/lib/editor/results-view';
import { useStoredPreference } from './use-stored-preference';
import './results-control.css';

export function useResultsView() {
  const { userId } = useAuth();
  return useStoredPreference<ResultsView>(resultsViewKey(userId), decodeResultsView, String);
}

const CHOICES: { value: ResultsView; label: string; detail: string }[] = [
  { value: 'chat', label: 'Show in chat', detail: 'Clips are played here.' },
  { value: 'timeline', label: 'Open the timeline', detail: 'Go straight to the full editor.' },
];

export function ResultsControl({ value, onChange, disabled }: { value: ResultsView; onChange: (value: ResultsView) => void; disabled?: boolean }) {
  return <Popover>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="results-control" disabled={disabled} aria-label={`Results: ${CHOICES.find(choice => choice.value === value)!.label}`}><GalleryVertical aria-hidden="true" />Results</Button></PopoverTrigger>
    <PopoverContent align="start" side="top" sideOffset={10} className="results-control-menu">
      <RadioGroup value={value} onValueChange={next => onChange(next as ResultsView)} aria-label="Where results are shown">
        {CHOICES.map(choice => <label key={choice.value} className="results-control-choice" data-checked={choice.value === value || undefined}>
          <RadioGroupItem value={choice.value} />
          <span><strong>{choice.label}</strong><small>{choice.detail}</small></span>
        </label>)}
      </RadioGroup>
    </PopoverContent>
  </Popover>;
}
