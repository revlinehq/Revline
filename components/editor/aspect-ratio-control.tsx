'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type SafeAreaPlatform } from '@/lib/editor/safe-areas';
import { aspectRatioLabel, dimensions, type AspectRatio } from '@/lib/editor/types';
import { Fragment } from 'react';
import './aspect-ratio-control.css';

/** Menu order and names follow the approved Pen design (eqEih): where each format is posted. */
const FORMATS: { value: AspectRatio; ratio: string; label: string }[] = ([
  { value: 'landscape', label: 'YouTube' },
  { value: 'vertical', label: 'Reels·TikTok·Shorts' },
  { value: 'square', label: 'Square' },
  { value: 'portrait-feed', label: 'Feed' },
  { value: 'classic', label: 'Classic' },
] as const).map(format => ({ ...format, ratio: aspectRatioLabel(format.value) }));
const SAFE_AREA_CHOICES: { value: SafeAreaPlatform | 'off'; label: string }[] = [{ value: 'off', label: 'Off' }, { value: 'tiktok', label: 'TikTok' }, { value: 'instagram', label: 'Reels' }];

export function AspectRatioControl({ value, onChange, safeArea = null, onSafeAreaChange, disabled = false }: { disabled?: boolean; value: AspectRatio; onChange: (value: AspectRatio) => void; safeArea?: SafeAreaPlatform | null; onSafeAreaChange?: (value: SafeAreaPlatform | null) => void }) {
  const ratio = aspectRatioLabel(value);

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" disabled={disabled} className="aspect-ratio-trigger focus-visible:ring-0" aria-label={`Aspect ratio: ${ratio}`}>
        <span className="aspect-ratio-value">{ratio}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="format-menu" align="start" collisionPadding={8}>
      <DropdownMenuLabel className="format-heading">Video format</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={next => {
        const format = FORMATS.find(format => format.value === next);
        if (format && format.value !== value) onChange(format.value);
      }}>
        {FORMATS.map(format => {
          const { width, height } = dimensions(format.value);
          return <Fragment key={format.value}>
            <DropdownMenuRadioItem className="format-row" value={format.value} aria-label={`${format.label}, ${format.ratio}, ${width} by ${height} pixels`}>
              <span className="format-slot" aria-hidden="true"><span className="format-shape" data-ratio={format.value}/></span>
              <span className="format-copy"><span className="format-name">{format.label}</span><span className="format-size">{width} × {height}</span></span>
              <span className="format-ratio">{format.ratio}</span>
            </DropdownMenuRadioItem>
            {format.value === 'vertical' && value === 'vertical' && onSafeAreaChange && <div className="safe-area-panel">
              <span className="safe-area-label">Safe area</span>
              <ToggleGroup type="single" spacing={0} className="safe-area-toggle" aria-label="Safe area preview" value={safeArea ?? 'off'} onValueChange={next => { if (next) onSafeAreaChange(next === 'off' ? null : next as SafeAreaPlatform); }}>
                {SAFE_AREA_CHOICES.map(choice => <ToggleGroupItem key={choice.value} value={choice.value} className="safe-area-choice">{choice.label}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>}
          </Fragment>;
        })}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
