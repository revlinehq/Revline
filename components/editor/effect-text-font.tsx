'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { editorTextFont, isTextFont, TEXT_FONTS, type TextFontId } from '@/lib/editor/text-fonts';
import { TEXT_SIZE_MAX, TEXT_SIZE_MIN } from '@/lib/editor/quick-controls';
import { TextFontStyles } from './text-font-styles';

const SIZE_TYPING_PAUSE_MS = 300;

/**
 * Font and size for one Effects row's text (the captions, or the hook). Each font is named in its own face. Size is in
 * the timeline's text units (pixels on a 1080-wide frame) and applies while the slider moves, or a moment after typing;
 * `onSizeEnd` closes the undo step a drag or a typed number opened.
 */
export function EffectTextFont({ id, font, size, sizeMixed, disabled, onFont, onSize, onSizeEnd }: {
  id: string; font?: TextFontId; size?: number; sizeMixed?: boolean; disabled: boolean;
  onFont: (font: TextFontId) => void; onSize: (size: number) => void; onSizeEnd: () => void;
}) {
  const shown = size === undefined || sizeMixed ? '' : String(size);
  const [draft, setDraft] = useState(shown), [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setDraft(shown); }, [shown, typing]);
  // A typed number applies after a short pause, so "120" never passes through 12 on the way. `dirty` holds a typed
  // value not yet applied; leaving the field without typing writes nothing.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null), dirty = useRef(false), open = useRef(false);
  const latest = useRef({ onSize, onSizeEnd }); latest.current = { onSize, onSizeEnd };
  const cancel = () => { if (pending.current) { clearTimeout(pending.current); pending.current = null; } };
  const resize = (value: number) => { open.current = true; latest.current.onSize(value); };
  const end = () => { cancel(); dirty.current = false; if (open.current) { open.current = false; latest.current.onSizeEnd(); } };
  const apply = (text: string, clamp: boolean) => {
    cancel(); dirty.current = false;
    const value = Number(text);
    if (!text.trim() || !Number.isFinite(value)) return;
    if (clamp) resize(Math.round(Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, value))));
    else if (value >= TEXT_SIZE_MIN && value <= TEXT_SIZE_MAX) resize(Math.round(value));
  };
  // Locked (an agent edit, a timeline switch) or gone: drop a waiting number and close the undo step it opened.
  useEffect(() => { if (disabled) end(); }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => end, []); // eslint-disable-line react-hooks/exhaustive-deps
  const typed = (text: string) => {
    setDraft(text); dirty.current = true; cancel();
    pending.current = setTimeout(() => apply(text, false), SIZE_TYPING_PAUSE_MS);
  };
  const leave = () => { if (dirty.current) apply(draft, true); end(); setTyping(false); };
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
        value={[size ?? TEXT_SIZE_MIN]} onValueChange={([value]) => { cancel(); dirty.current = false; resize(value); }} onValueCommit={end}/>
      <Input id={`${id}-size`} aria-label="Font size" className="effect-input effect-size-input" type="number" inputMode="numeric" min={TEXT_SIZE_MIN} max={TEXT_SIZE_MAX} step={1}
        placeholder={sizeMixed ? 'Mixed' : undefined} disabled={disabled || size === undefined} value={draft}
        onFocus={() => setTyping(true)} onChange={event => typed(event.target.value)} onBlur={leave}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>
    </div>
  </div>;
}
