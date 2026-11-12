'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { visualEffectActionPatch } from '@/lib/editor/visual-effect-actions';
import { VISUAL_EFFECT_DEFAULTS, VISUAL_EFFECT_KEYS, VISUAL_EFFECT_LIMITS, visualEffectsPatch, type VisualEffects } from '@/lib/editor/visual-effects';
import type { Clip } from '@/lib/editor/types';
import { EffectIcon, type EffectIconName } from './effect-icon';

export type AppliedEffectKey = keyof VisualEffects;

/** Plain names for every footage effect a clip can carry, including retired ones still on saved clips. */
export const EFFECT_NAMES: Record<AppliedEffectKey, string> = {
  bloom: 'Bloom', colorGrade: 'Color grade', zoomBlur: 'Zoom blur', glitch: 'Digital glitch', invert: 'Invert colors', dither: 'Dither',
  neonEdges: 'Neon edges', lensDistortion: 'Lens distortion', filmOverlay: 'Film overlay', vhs: 'VHS overlay', lightLeak: 'Light leak',
  directionalBlur: 'Directional blur', turbulentDisplace: 'Turbulent displace', lightSweep: 'Light sweep', softBlur: 'Soft blur',
  frameDistortion: 'Frame distortion', frameCorners: 'Rounded corners',
};
const CONTROL_NAMES: Record<string, string> = { rgbSplit: 'RGB split', blockSize: 'Block size', centerX: 'Center X', centerY: 'Center Y' };
const WHOLE_NUMBERS = new Set(['dither.levels', 'dither.size', 'glitch.blockSize']);

/** The footage effects saved on a clip, in render order. */
export function appliedEffects(clip: Clip | undefined): AppliedEffectKey[] {
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'image')) return [];
  return VISUAL_EFFECT_KEYS.filter(key => clip[key] !== undefined);
}

function controlName(control: string) {
  return CONTROL_NAMES[control] ?? control.replace(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase()).replace(/ ([A-Z])/g, (_, letter: string) => ` ${letter.toLowerCase()}`);
}
function shownValue(control: string, value: number, [min, max]: readonly [number, number]) {
  if (control === 'angle') return `${Math.round(value)}°`;
  if (min >= -1 && max <= 1) return `${Math.round(value * 100)}%`;
  return max - min >= 10 ? `${Math.round(value)}` : value.toFixed(2);
}

function EffectIconFor({ effect }: { effect: AppliedEffectKey }) {
  return effect === 'bloom' || effect === 'frameCorners' ? <Sparkles size={16} strokeWidth={1.5} aria-hidden="true"/> : <EffectIcon name={effect as EffectIconName} size={16}/>;
}

/** "Applied": every footage effect on the selected clip, each with on/off, remove, and its settings one click away.
 *  Slider drags are one undo step per drag; every change goes through the editor's normal clip patch path. `onPatch`
 *  takes a builder so the patch is made from the clip as it is when the edit lands, and its errors reach the user. */
export function AppliedEffects({ clip, effects, locked, onPatch, onBeginDrag, onEndDrag }: {
  clip: Clip; effects: AppliedEffectKey[]; locked: boolean;
  onPatch: (build: (clip: Clip) => Partial<Clip>, fallback: string) => void;
  onBeginDrag: (key: string) => void; onEndDrag: () => void;
}) {
  const [open, setOpen] = useState<AppliedEffectKey | null>(null);
  // A drag cut short (the editor locks, the clip changes or the panel closes) still closes its undo step.
  const dragging = useRef(false);
  useEffect(() => () => { if (dragging.current) { dragging.current = false; onEndDrag(); } }, [clip.id, locked]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!effects.length) return <p className="effect-hint effect-applied-empty">Nothing on this clip yet. Ask in the chat to add an effect.</p>;
  return <ul className="effect-applied-list">
    {effects.map(effect => {
      const settings = clip[effect] as unknown as Record<string, unknown> & { enabled: boolean };
      const limits = VISUAL_EFFECT_LIMITS[effect] as Record<string, readonly [number, number]>;
      const name = EFFECT_NAMES[effect], expanded = open === effect;
      const set = (patch: Record<string, unknown>, fallback: string) => onPatch(live => visualEffectsPatch(live, { [effect]: patch }) as Partial<Clip>, fallback);
      return <li key={effect} className="effect-applied-item" data-open={expanded || undefined}>
        <Collapsible open={expanded} onOpenChange={next => setOpen(next ? effect : null)}>
          <div className="effect-applied-head">
            <Button type="button" variant="ghost" className="effect-applied-name" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : effect)}>
              <EffectIconFor effect={effect}/><span>{name}</span>{expanded ? <ChevronUp size={14} aria-hidden="true"/> : <ChevronDown size={14} aria-hidden="true"/>}
            </Button>
            <Switch className="effect-switch" aria-label={`${name} on`} checked={settings.enabled} disabled={locked} onCheckedChange={enabled => set({ enabled }, `Could not turn ${name.toLowerCase()} ${enabled ? 'on' : 'off'}.`)}/>
            <Button type="button" variant="ghost" size="icon-xs" className="effect-applied-remove" aria-label={`Remove ${name}`} disabled={locked} onClick={() => onPatch(live => visualEffectActionPatch(live, effect, 'remove') as Partial<Clip>, `Could not remove ${name.toLowerCase()}.`)}><X size={14}/></Button>
          </div>
          <CollapsibleContent className="effect-applied-settings">
            {Object.entries(limits).map(([control, range]) => {
              // A frame distortion saved before bend existed draws with no bend.
              const fallback = effect === 'frameDistortion' && control === 'bend' ? 0 : (VISUAL_EFFECT_DEFAULTS[effect] as unknown as Record<string, number>)[control] ?? range[0];
              const value = typeof settings[control] === 'number' ? settings[control] as number : fallback;
              const whole = WHOLE_NUMBERS.has(`${effect}.${control}`), step = whole ? 1 : (range[1] - range[0]) / 100;
              // A keyframed control draws from its keyframes, so its static value is not offered here.
              const keyed = clip.effectKeyframes?.some(lane => lane.control === `${effect}.${control}`);
              return <div key={control} className="effect-param">
                <span className="effect-param-label" id={`effect-${effect}-${control}`}>{controlName(control)}</span>
                <Slider className="effect-slider" aria-labelledby={`effect-${effect}-${control}`} min={range[0]} max={range[1]} step={step} value={[value]} disabled={locked || keyed}
                  onValueChange={([next]) => { dragging.current = true; onBeginDrag(`effect-${clip.id}-${effect}-${control}`); set({ [control]: whole ? Math.round(next) : next }, `Could not change ${name.toLowerCase()}.`); }}
                  onValueCommit={() => { dragging.current = false; onEndDrag(); }}/>
                <span className="effect-param-value" title={keyed ? 'Animated with keyframes' : undefined}>{keyed ? 'Keyed' : shownValue(control, value, range)}</span>
              </div>;
            })}
            <Button type="button" variant="ghost" size="sm" className="effect-reset" disabled={locked} onClick={() => onPatch(live => visualEffectActionPatch(live, effect, 'reset') as Partial<Clip>, `Could not reset ${name.toLowerCase()}.`)}><RotateCcw size={14}/>Reset</Button>
          </CollapsibleContent>
        </Collapsible>
      </li>;
    })}
  </ul>;
}
