'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { AspectRatio } from '@/lib/editor/types';
import './aspect-ratio-control.css';

const FORMATS: { value: AspectRatio; ratio: string; label: string }[] = [
  { value: 'vertical', ratio: '9:16', label: 'Portrait' },
  { value: 'portrait-feed', ratio: '4:5', label: 'Portrait feed' },
  { value: 'square', ratio: '1:1', label: 'Square' },
  { value: 'classic', ratio: '4:3', label: 'Classic' },
  { value: 'landscape', ratio: '16:9', label: 'Landscape' },
];

export function AspectRatioControl({ value, onChange }: { value: AspectRatio; onChange: (value: AspectRatio) => void }) {
  const format = FORMATS.find(format => format.value === value)!;

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" className="aspect-ratio-trigger" aria-label={`Aspect ratio: ${format.ratio}`}>
        <span className="aspect-ratio-label">Aspect ratio</span>
        <span className="aspect-ratio-value">{format.ratio}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="aspect-ratio-menu" align="start">
      <DropdownMenuRadioGroup value={value} onValueChange={next => {
        const format = FORMATS.find(format => format.value === next);
        if (format && format.value !== value) onChange(format.value);
      }}>
        {FORMATS.map(format => <DropdownMenuRadioItem key={format.value} value={format.value}>
          <span className="aspect-ratio-option">{format.ratio}</span>
          <span>{format.label}</span>
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
