'use client';

import { ChevronDown, Zap } from 'lucide-react';
import { EDITOR_MODELS, EDITOR_REASONING_EFFORTS, type ClaudeModelChoice, type EditorReasoningEffort, type EditorSpeedMode } from '@/lib/ai/claude-model';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroupButton } from '@/components/ui/input-group';

const descriptions: Record<typeof EDITOR_MODELS[number]['id'], string> = { 'gpt-6.1-sol': 'OpenAI · everyday editing', 'gpt-6-astra': 'OpenAI · complex editing', 'gpt-6.1-terra': 'OpenAI · fast, lower cost', 'gpt-5.4-mini': 'OpenAI · cheaper, simple edits', sonnet: 'Anthropic · everyday editing', opus: 'Anthropic · complex editing' };


export function AssistantModelPicker({ value, onChange, disabled, allowedModels }: {
  value: ClaudeModelChoice;
  onChange: (value: ClaudeModelChoice) => void;
  disabled: boolean;
  allowedModels: readonly ClaudeModelChoice[];
}) {
  const models = EDITOR_MODELS.filter(model => allowedModels.includes(model.id));
  const selected = models.find(model => model.id === value) ?? models[0];
  return <DropdownMenu><DropdownMenuTrigger asChild><InputGroupButton size="sm" aria-label="AI editing model" disabled={disabled}>{selected?.label}<ChevronDown /></InputGroupButton></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-56" aria-label="AI editing model options">
      <DropdownMenuRadioGroup value={value} onValueChange={next => { const model = models.find(model => model.id === next); if (model) onChange(model.id); }}>
        {models.map(model => <DropdownMenuRadioItem key={model.id} value={model.id}><span className="flex flex-col"><span>{model.label}</span><span className="text-xs text-muted-foreground">{descriptions[model.id]}</span></span></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

const effortLabels: Record<EditorReasoningEffort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-high', max: 'Max' };

/** Reasoning effort and, where the model offers it, Fast mode share one menu; the trigger shows a bolt while Fast mode is on. */
export function AssistantReasoningPicker({ effort, speed, fastAvailable, onEffortChange, onSpeedChange, disabled }: {
  effort: EditorReasoningEffort;
  speed: EditorSpeedMode;
  fastAvailable: boolean;
  onEffortChange: (value: EditorReasoningEffort) => void;
  onSpeedChange: (value: EditorSpeedMode) => void;
  disabled: boolean;
}) {
  const fast = fastAvailable && speed === 'fast';
  return <DropdownMenu><DropdownMenuTrigger asChild><InputGroupButton size="sm" aria-label="AI reasoning effort" aria-description={fast ? 'Fast mode on' : undefined} disabled={disabled}>{fast && <Zap className="fill-current text-[#f5b301]" aria-hidden="true"/>}{effortLabels[effort]}<ChevronDown /></InputGroupButton></DropdownMenuTrigger>
    <DropdownMenuContent align="start" aria-label="AI reasoning effort options">
      <DropdownMenuRadioGroup value={effort} onValueChange={next => { const value = EDITOR_REASONING_EFFORTS.find(option => option === next); if (value) onEffortChange(value); }}>
        {EDITOR_REASONING_EFFORTS.map(value => <DropdownMenuRadioItem key={value} value={value}>{effortLabels[value]}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      {fastAvailable && <>
      <DropdownMenuSeparator />
      {/* Toggling speed keeps the menu open so the new state is visible. */}
      <DropdownMenuCheckboxItem checked={fast} onCheckedChange={checked => onSpeedChange(checked ? 'fast' : 'standard')} onSelect={event => event.preventDefault()}><Zap className={fast ? 'fill-current text-[#f5b301]' : undefined} aria-hidden="true"/><span className="flex flex-col"><span>Fast mode</span><span className="text-xs text-muted-foreground">Faster replies · 2× token cost</span></span></DropdownMenuCheckboxItem></>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
