'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { editorTextFont, isTextFont, TEXT_FONTS, type TextFontId } from '@/lib/editor/text-fonts';
import { TEXT_SIZE_MAX, TEXT_SIZE_MIN } from '@/lib/editor/quick-controls';
import { TextFontStyles } from './text-font-styles';

/**
 * Font and size for one Effects row's text (the captions, or the hook). Each font is named in its own face. Size is in
 * the timeline's text units (pixels on a 1080-wide frame) and applies while the slider moves or the number is typed;
 * `onSizeEnd` closes the undo step a drag or a typed number opened.
 */
export function EffectTextFont({ id, font, size, disabled, onFont, onSize, onSizeEnd }: {
  id: string; font?: TextFontId; size?: number; disabled: boolean;
  onFont: (font: TextFontId) => void; onSize: (size: number) => void; onSizeEnd: () => void;
}) {
  const [draft, setDraft] = useState(size === undefined ? '' : String(size));
  const [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setDraft(size === undefined ? '' : String(size)); }, [size, typing]);
  const typed = (text: string) => {
    setDraft(text);
    const value = Number(text);
    if (text.trim() && Number.isFinite(value) && value >= TEXT_SIZE_MIN && value <= TEXT_SIZE_MAX) onSize(Math.round(value));
  };
  const leave = () => { setTyping(false); setDraft(size === undefined ? '' : String(size)); onSizeEnd(); };
  return <div className="effect-text-font">
    <TextFontStyles/>
    <Select value={font ?? ''} disabled={disabled} onValueChange={value => { if (isTextFont(value)) onFont(value); }}>
      <SelectTrigger id={`${id}-font`} aria-label="Font" className="effect-font-trigger" style={font ? { fontFamily: editorTextFont(font).family } : undefined}>
        <SelectValue placeholder="Mixed fonts"/>
      </SelectTrigger>
      <SelectContent className="effect-font-menu" position="popper">
        {TEXT_FONTS.map(item => <SelectItem key={item.id} value={item.id} style={{ fontFamily: editorTextFont(item.id).family }}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
    <div className="effect-size">
      <Slider className="effect-size-slider" aria-label="Font size" min={TEXT_SIZE_MIN} max={TEXT_SIZE_MAX} step={1} disabled={disabled || size === undefined}
        value={[size ?? TEXT_SIZE_MIN]} onValueChange={([value]) => onSize(value)} onValueCommit={() => onSizeEnd()}/>
      <Input id={`${id}-size`} aria-label="Font size" className="effect-input effect-size-input" type="number" inputMode="numeric" min={TEXT_SIZE_MIN} max={TEXT_SIZE_MAX} step={1}
        disabled={disabled || size === undefined} value={draft}
        onFocus={() => setTyping(true)} onChange={event => typed(event.target.value)} onBlur={leave}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>
    </div>
  </div>;
}
