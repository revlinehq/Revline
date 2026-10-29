'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { standaloneSvg } from '@/lib/editor/brand-kit';
import type { ChatTool } from './assistant-results';
import './choice-card.css';

type Choice = { value: string; title: string; description?: string; logo?: string; reply: string };

/** A question the assistant asked with askUser or askBrandKit, as choices; null for any other step. */
export function choiceOf(step: ChatTool): { question: string; choices: Choice[] } | null {
  const output = step.output;
  if (step.state !== 'done' || !output || typeof output.question !== 'string') return null;
  if (step.name === 'askUser' && Array.isArray(output.options)) return { question: output.question, choices: (output.options as { label: string; description?: string }[]).map((option, index) => ({ value: String(index), title: option.label, ...(option.description ? { description: option.description } : {}), reply: option.label })) };
  if (step.name === 'askBrandKit' && Array.isArray(output.kits)) return { question: output.question, choices: (output.kits as { kitId: string; name: string; site?: string; logo?: string; screens?: string[]; blueprints?: string[] }[]).map(kit => {
    const ready = [kit.screens?.length ? `${kit.screens.length} ${kit.screens.length === 1 ? 'screen' : 'screens'}` : '', kit.blueprints?.length ? `${kit.blueprints.length} ${kit.blueprints.length === 1 ? 'blueprint' : 'blueprints'}` : ''].filter(Boolean).join(' · ');
    const logo = kit.logo ? kit.logo.startsWith('<svg') ? `data:image/svg+xml;utf8,${encodeURIComponent(standaloneSvg(kit.logo))}` : kit.logo : undefined;
    return { value: kit.kitId, title: kit.name, description: [kit.site ? new URL(kit.site).host : '', ready].filter(Boolean).join(' · ') || undefined, ...(logo ? { logo } : {}), reply: `Use the ${kit.name} brand kit.` };
  }) };
  return null;
}

/** shadcn choice cards for the assistant's question; the pick is sent as the user's reply. */
export function ChoiceCard({ question, choices, onChoose, disabled }: { question: string; choices: Choice[]; onChoose?: (reply: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('');
  const chosen = choices.find(choice => choice.value === value);
  return <FieldSet className="choice-card">
    <FieldLegend variant="label">{question}</FieldLegend>
    <RadioGroup value={value} onValueChange={setValue} disabled={disabled || !onChoose}>
      {choices.map(choice => <FieldLabel key={choice.value} htmlFor={`choice-${choice.value}`}>
        <Field orientation="horizontal">
          {choice.logo && <span className="choice-card-logo" style={{ maskImage: `url("${choice.logo}")`, WebkitMaskImage: `url("${choice.logo}")` }} aria-hidden="true" />}
          <FieldContent>
            <FieldTitle>{choice.title}</FieldTitle>
            {choice.description && <FieldDescription>{choice.description}</FieldDescription>}
          </FieldContent>
          <RadioGroupItem value={choice.value} id={`choice-${choice.value}`} />
        </Field>
      </FieldLabel>)}
    </RadioGroup>
    {onChoose && <Button type="button" size="sm" className="choice-card-send" disabled={disabled || !chosen} onClick={() => chosen && onChoose(chosen.reply)}>Continue</Button>}
  </FieldSet>;
}
