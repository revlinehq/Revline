'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SAFE_AREAS, type SafeAreaPlatform } from '@/lib/editor/safe-areas';
import { dimensions, type AspectRatio } from '@/lib/editor/types';
import './aspect-ratio-control.css';

const FORMATS: { value: AspectRatio; ratio: string; label: string }[] = [
  { value: 'vertical', ratio: '9:16', label: 'Reels/Shorts' },
  { value: 'square', ratio: '1:1', label: 'Square' },
  { value: 'landscape', ratio: '16:9', label: 'Landscape' },
  { value: 'portrait-feed', ratio: '4:5', label: 'Portrait' },
  { value: 'classic', ratio: '4:3', label: 'Classic' },
];

const RATIOS: Record<AspectRatio, string> = {
  vertical: '9:16', 'portrait-feed': '4:5', square: '1:1', classic: '4:3', landscape: '16:9',
};

export function AspectRatioControl({ value, onChange, safeArea = null, onSafeAreaChange }: { value: AspectRatio; onChange: (value: AspectRatio) => void; safeArea?: SafeAreaPlatform | null; onSafeAreaChange?: (value: SafeAreaPlatform | null) => void }) {
  const ratio = RATIOS[value];

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" className="aspect-ratio-trigger focus-visible:ring-0" aria-label={`Aspect ratio: ${ratio}`}>
        <span className="aspect-ratio-value">{ratio}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="aspect-ratio-menu" align="start" collisionPadding={8}>
      <DropdownMenuRadioGroup className="aspect-ratio-options" value={value} onValueChange={next => {
        const format = FORMATS.find(format => format.value === next);
        if (format && format.value !== value) onChange(format.value);
      }}>
        {FORMATS.map(format => {
          const { width, height } = dimensions(format.value);
          return <DropdownMenuRadioItem className="aspect-ratio-card" key={format.value} value={format.value} aria-label={`${format.label}, ${format.ratio}, ${width} by ${height} pixels`}>
            <span className="aspect-ratio-preview" aria-hidden="true"><span className="aspect-ratio-shape" data-ratio={format.value}>
              <span className="aspect-ratio-dimensions"><span>{width}</span><span>×</span><span>{height}</span></span>
            </span></span>
            <span className="aspect-ratio-value">{format.ratio}</span>
            <span className="aspect-ratio-name">{format.label}</span>
          </DropdownMenuRadioItem>;
        })}
      </DropdownMenuRadioGroup>
      {value === 'vertical' && onSafeAreaChange && <>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="safe-area-menu-label">Safe area preview</DropdownMenuLabel>
        <DropdownMenuRadioGroup className="safe-area-options" value={safeArea ?? 'off'} onValueChange={next => onSafeAreaChange(next === 'off' ? null : next as SafeAreaPlatform)}>
          <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
          {(Object.keys(SAFE_AREAS) as SafeAreaPlatform[]).map(platform => <DropdownMenuRadioItem key={platform} value={platform}>{SAFE_AREAS[platform].label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
