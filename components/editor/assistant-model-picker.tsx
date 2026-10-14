'use client';

import { CLAUDE_EDIT_MODELS, type ClaudeModelChoice } from '@/lib/ai/claude-model';
import { InspectorSelect } from './inspector-select';
import './assistant-model-picker.css';

const options = CLAUDE_EDIT_MODELS.map(model => ({ value: model.id, label: model.label }));

export function AssistantModelPicker({ value, onChange, disabled }: {
  value: ClaudeModelChoice;
  onChange: (value: ClaudeModelChoice) => void;
  disabled: boolean;
}) {
  return <div className="assistant-model-picker"><InspectorSelect label="AI editing model" value={value} options={options} onChange={onChange} disabled={disabled}/></div>;
}
