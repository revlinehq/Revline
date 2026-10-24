'use client';

import { EDITOR_MODELS, type ClaudeModelChoice } from '@/lib/ai/claude-model';
import { InspectorSelect } from './inspector-select';
import './assistant-model-picker.css';

const descriptions: Record<typeof EDITOR_MODELS[number]['id'], string> = { 'gpt-6.1-sol': 'OpenAI · everyday editing', 'gpt-6-astra': 'OpenAI · complex editing', sonnet: 'Anthropic · everyday editing', opus: 'Anthropic · complex editing' };


export function AssistantModelPicker({ value, onChange, disabled, allowedModels }: {
  value: ClaudeModelChoice;
  onChange: (value: ClaudeModelChoice) => void;
  disabled: boolean;
  allowedModels: readonly ClaudeModelChoice[];
}) {
  const options = EDITOR_MODELS.filter(model => allowedModels.includes(model.id)).map(model => ({ value: model.id, label: model.label, description: descriptions[model.id] }));
  return <div className="assistant-model-picker"><InspectorSelect label="AI editing model" value={value} options={options} onChange={onChange} disabled={disabled}/></div>;
}
