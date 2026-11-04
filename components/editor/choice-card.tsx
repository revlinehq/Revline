'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { standaloneSvg } from '@/lib/editor/brand-kit';
import type { ChatTool } from './assistant-results';
import './choice-card.css';

type Choice = { value: string; title: string; description?: string; logo?: string; image?: string; audio?: string; reply: string };

/** A question the assistant asked with askUser or askBrandKit, as choices; null for any other step. */
export function choiceOf(step: ChatTool): { question: string; choices: Choice[] } | null {
  const output = step.output;
  if (step.state !== 'done' || !output || typeof output.question !== 'string') return null;
  if (step.name === 'askUser' && Array.isArray(output.options)) return { question: output.question, choices: (output.options as { label: string; description?: string; image?: string; audio?: string }[]).map((option, index) => ({ value: String(index), title: option.label, ...(option.description ? { description: option.description } : {}), ...(option.image ? { image: option.image } : {}), ...(option.audio ? { audio: option.audio } : {}), reply: option.label })) };
  if (step.name === 'askBrandKit' && Array.isArray(output.kits)) return { question: output.question, choices: (output.kits as { kitId: string; name: string; site?: string; logo?: string; screens?: string[]; blueprints?: string[] }[]).map(kit => {
    const ready = [kit.screens?.length ? `${kit.screens.length} ${kit.screens.length === 1 ? 'screen' : 'screens'}` : '', kit.blueprints?.length ? `${kit.blueprints.length} ${kit.blueprints.length === 1 ? 'blueprint' : 'blueprints'}` : ''].filter(Boolean).join(' · ');
    const logo = kit.logo ? kit.logo.startsWith('<svg') ? `data:image/svg+xml;utf8,${encodeURIComponent(standaloneSvg(kit.logo))}` : kit.logo : undefined;
    return { value: kit.kitId, title: kit.name, description: [kit.site ? new URL(kit.site).host : '', ready].filter(Boolean).join(' · ') || undefined, ...(logo ? { logo } : {}), reply: `Use the ${kit.name} brand kit.` };
  }) };
  return null;
}

/** shadcn choice cards for the assistant's question; the pick is sent as the user's reply. */
export function ChoiceCard({ question, choices, onChoose, disabled }: { question: string; choices: Choice[]; onChoose?: (reply: string) => void; disabled: boolean }) {
  const id = useId();
  const [value, setValue] = useState('');
  const [playing, setPlaying] = useState('');
  const player = useRef<HTMLAudioElement | null>(null);
  const chosen = choices.find(choice => choice.value === value);
  useEffect(() => () => player.current?.pause(), []);
  // One sample plays at a time; playing never picks the option.
  const toggle = (choice: Choice) => {
    player.current?.pause();
    if (playing === choice.value) { setPlaying(''); return; }
    const audio = new Audio(choice.audio);
    audio.onended = () => setPlaying(current => current === choice.value ? '' : current);
    player.current = audio;
    setPlaying(choice.value);
    void audio.play().catch(() => setPlaying(''));
  };
  return <FieldSet className="choice-card" data-pictures={choices.some(choice => choice.image) || undefined}>
    <FieldLegend variant="label">{question}</FieldLegend>
    <RadioGroup value={value} onValueChange={setValue} disabled={disabled || !onChoose}>
      {choices.map(choice => <FieldLabel key={choice.value} htmlFor={`${id}-${choice.value}`} onClick={() => { if (!disabled && onChoose) setValue(choice.value); }}>
        {choice.image && <AspectRatio ratio={16 / 9} className="choice-card-image"><img src={choice.image} alt={choice.title} loading="lazy" onError={event => { event.currentTarget.hidden = true; }} /></AspectRatio>}
        <Field orientation="horizontal">
          {choice.logo && <span className="choice-card-logo" style={{ maskImage: `url("${choice.logo}")`, WebkitMaskImage: `url("${choice.logo}")` }} aria-hidden="true" />}
          {choice.audio && <Button type="button" variant="outline" size="icon-sm" aria-label={playing === choice.value ? `Pause ${choice.title}` : `Play ${choice.title}`} onClick={event => { event.preventDefault(); event.stopPropagation(); toggle(choice); }}>{playing === choice.value ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button>}
          <FieldContent>
            <FieldTitle>{choice.title}</FieldTitle>
            {choice.description && <FieldDescription>{choice.description}</FieldDescription>}
          </FieldContent>
          <RadioGroupItem value={choice.value} id={`${id}-${choice.value}`} />
        </Field>
      </FieldLabel>)}
    </RadioGroup>
    {onChoose && <Button type="button" size="sm" className="choice-card-send" disabled={disabled || !chosen} onClick={() => chosen && onChoose(chosen.reply)}>Continue</Button>}
  </FieldSet>;
}
