'use client';

import { ChevronDown, LayoutTemplate } from 'lucide-react';
import { EDITOR_MODELS, EDITOR_REASONING_EFFORTS, type ClaudeModelChoice, type EditorReasoningEffort } from '@/lib/ai/claude-model';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ClaudeLogo, GoogleLogo, OpenAILogo } from '@/components/workspace/ai-app-logos';
import { InspectorSelect } from './inspector-select';
import './assistant-model-picker.css';

/** The provider's mark beside each model. */
const providerLogo = (id: ClaudeModelChoice) => id.startsWith('gpt') ? <OpenAILogo className="assistant-model-logo" /> : id.startsWith('gemini') ? <GoogleLogo className="assistant-model-logo" /> : <ClaudeLogo className="assistant-model-logo" />;


export function AssistantModelPicker({ value, onChange, disabled, allowedModels }: {
  value: ClaudeModelChoice;
  onChange: (value: ClaudeModelChoice) => void;
  disabled: boolean;
  allowedModels: readonly ClaudeModelChoice[];
}) {
  const options = EDITOR_MODELS.filter(model => allowedModels.includes(model.id)).map(model => ({ value: model.id, label: model.label, ...('shortLabel' in model ? { shortLabel: model.shortLabel } : {}), icon: providerLogo(model.id) }));
  return <div className="assistant-model-picker"><InspectorSelect label="AI editing model" value={value} options={options} onChange={onChange} disabled={disabled}/></div>;
}

const effortLabels: Record<EditorReasoningEffort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-high', max: 'Max' };

/** Development only: Auto lets the editor pick per request and shows its live pick while a run works. */
export function AssistantEffortPicker({ value, live, onChange, disabled }: {
  value?: EditorReasoningEffort;
  live?: EditorReasoningEffort;
  onChange: (value: EditorReasoningEffort | undefined) => void;
  disabled: boolean;
}) {
  const options = [{ value: 'auto' as const, label: live ? `Auto · ${effortLabels[live]}` : 'Auto' }, ...EDITOR_REASONING_EFFORTS.map(effort => ({ value: effort, label: effortLabels[effort] }))];
  return <div className="assistant-model-picker"><InspectorSelect label="AI reasoning effort" value={value ?? 'auto'} options={options} onChange={next => onChange(next === 'auto' ? undefined : next)} disabled={disabled}/></div>;
}

/** Blueprints from the user's brand kits to build the next request from; picked ones show as composer chips. */
export function BlueprintPicker({ items, chosen, onChange, disabled }: { items: { name: string; kit: string; score: number | null }[]; chosen: string[]; onChange: (names: string[]) => void; disabled: boolean }) {
  return <div className="assistant-model-picker"><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="inspector-select-trigger" aria-label="Attach blueprints" disabled={disabled}><LayoutTemplate size={13} aria-hidden="true"/><span className="inspector-select-value">{chosen.length ? `Blueprints · ${chosen.length}` : 'Blueprints'}</span><ChevronDown size={13}/></button></DropdownMenuTrigger>
    <DropdownMenuContent className="workspace-menu inspector-select-menu" aria-label="Blueprint options" sideOffset={5}>
      {items.map(item => <DropdownMenuCheckboxItem key={`${item.kit}:${item.name}`} checked={chosen.includes(item.name)} onSelect={event => event.preventDefault()} onCheckedChange={checked => onChange(checked ? [...chosen, item.name].slice(0, 4) : chosen.filter(name => name !== item.name))} className="workspace-menu-item inspector-select-option">
        <span className="inspector-select-option-copy"><span className="inspector-select-value">{item.name}</span><small>{item.kit}{item.score !== null ? ` · ${item.score.toFixed(1)}% match` : ''}</small></span>
      </DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu></div>;
}

