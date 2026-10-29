'use client';

import { ChevronDown, Zap } from 'lucide-react';
import { EDITOR_MODELS, EDITOR_REASONING_EFFORTS, type ClaudeModelChoice, type EditorReasoningEffort, type EditorSpeedMode } from '@/lib/ai/claude-model';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
  const options = EDITOR_MODELS.filter(model => allowedModels.includes(model.id)).map(model => ({ value: model.id, label: model.label, icon: providerLogo(model.id) }));
  return <div className="assistant-model-picker"><InspectorSelect label="AI editing model" value={value} options={options} onChange={onChange} disabled={disabled}/></div>;
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
  return <div className="assistant-model-picker assistant-reasoning-picker"><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="inspector-select-trigger" aria-label="AI reasoning effort" aria-description={fast ? 'Fast mode on' : undefined} disabled={disabled}>{fast && <Zap size={12} className="assistant-fast-icon" aria-hidden="true"/>}<span className="inspector-select-value">{effortLabels[effort]}</span><ChevronDown size={13}/></button></DropdownMenuTrigger>
    <DropdownMenuContent className="workspace-menu inspector-select-menu" aria-label="AI reasoning effort options" sideOffset={5}>
      <DropdownMenuRadioGroup value={effort} onValueChange={next => { const value = EDITOR_REASONING_EFFORTS.find(option => option === next); if (value) onEffortChange(value); }}>
        {EDITOR_REASONING_EFFORTS.map(value => <DropdownMenuRadioItem key={value} value={value} data-value={value} className="workspace-menu-item inspector-select-option"><span className="inspector-select-option-copy"><span className="inspector-select-value">{effortLabels[value]}</span></span></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      {fastAvailable && <>
      <DropdownMenuSeparator className="assistant-reasoning-separator"/>
      {/* Toggling speed keeps the menu open so the new state is visible. */}
      <DropdownMenuCheckboxItem checked={fast} onCheckedChange={checked => onSpeedChange(checked ? 'fast' : 'standard')} onSelect={event => event.preventDefault()} data-value="fast" className="workspace-menu-item inspector-select-option assistant-fast-option"><Zap size={14} className="assistant-fast-icon" aria-hidden="true"/><span className="inspector-select-option-copy"><span className="inspector-select-value">Fast mode</span><small>Faster replies · 2× token cost</small></span></DropdownMenuCheckboxItem></>}
    </DropdownMenuContent>
  </DropdownMenu></div>;
}
