'use client';

import { CLAUDE_EDIT_MODELS, type ClaudeModelChoice } from '@/lib/ai/claude-model';
import { InspectorSelect } from './inspector-select';
import './assistant-model-picker.css';

const descriptions = { haiku: 'Fast, simple edits', sonnet: 'Everyday editing', opus: 'Complex, coordinated edits' };


export function AssistantModelPicker({ value, onChange, disabled, allowedModels }: {
  value: ClaudeModelChoice;
  onChange: (value: ClaudeModelChoice) => void;
  disabled: boolean;
  allowedModels: readonly ClaudeModelChoice[];
}) {
  const options = CLAUDE_EDIT_MODELS.filter(model => allowedModels.includes(model.id)).map(model => ({ value: model.id, label: model.label, description: descriptions[model.id] }));
  return <div className="assistant-model-picker"><InspectorSelect label="AI editing model" value={value} options={options} onChange={onChange} disabled={disabled}/></div>;
}
