'use client';

import { ChevronDown, RectangleHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type SafeAreaPlatform } from '@/lib/editor/safe-areas';
import { dimensions, type AspectRatio } from '@/lib/editor/types';
import { Fragment } from 'react';
import './aspect-ratio-control.css';

/** Menu order and names follow the approved Pen design (eqEih): where each format is posted. */
const FORMATS: { value: AspectRatio; ratio: string; label: string }[] = [
  { value: 'landscape', ratio: '16:9', label: 'YouTube' },
  { value: 'vertical', ratio: '9:16', label: 'Reels·TikTok·Shorts' },
  { value: 'square', ratio: '1:1', label: 'Square' },
  { value: 'portrait-feed', ratio: '4:5', label: 'Feed' },
  { value: 'classic', ratio: '4:3', label: 'Classic' },
];
const SAFE_AREA_CHOICES: { value: SafeAreaPlatform | 'off'; label: string }[] = [{ value: 'off', label: 'Off' }, { value: 'tiktok', label: 'TikTok' }, { value: 'instagram', label: 'Reels' }];

const RATIOS: Record<AspectRatio, string> = {
  vertical: '9:16', 'portrait-feed': '4:5', square: '1:1', classic: '4:3', landscape: '16:9',
};

export function AspectRatioControl({ value, onChange, safeArea = null, onSafeAreaChange, appearance = 'preview', disabled = false }: { appearance?: 'preview' | 'composer'; disabled?: boolean; value: AspectRatio; onChange: (value: AspectRatio) => void; safeArea?: SafeAreaPlatform | null; onSafeAreaChange?: (value: SafeAreaPlatform | null) => void }) {
  const ratio = RATIOS[value];

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" disabled={disabled} className={`aspect-ratio-trigger focus-visible:ring-0${appearance === 'composer' ? ' composer-header-chip' : ''}`} aria-label={`Aspect ratio: ${ratio}`}>
        {appearance === 'composer' && <RectangleHorizontal size={12} aria-hidden="true" />}
        <span className="aspect-ratio-value">{appearance === 'composer' ? `Aspect ratio · ${ratio}` : ratio}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="aspect-ratio-menu" align="start" collisionPadding={8}>
      <DropdownMenuLabel className="aspect-ratio-heading">Video format</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={next => {
        const format = FORMATS.find(format => format.value === next);
        if (format && format.value !== value) onChange(format.value);
      }}>
        {FORMATS.map(format => {
          const { width, height } = dimensions(format.value);
          return <Fragment key={format.value}>
            <DropdownMenuRadioItem className="aspect-ratio-row" value={format.value} aria-label={`${format.label}, ${format.ratio}, ${width} by ${height} pixels`}>
              <span className="aspect-ratio-slot" aria-hidden="true"><span className="aspect-ratio-shape" data-ratio={format.value}/></span>
              <span className="aspect-ratio-copy"><span className="aspect-ratio-name">{format.label}</span><span className="aspect-ratio-dimensions">{width} × {height}</span></span>
              <span className="aspect-ratio-ratio">{format.ratio}</span>
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
