'use client';

import { CLAUDE_EDIT_MODELS, type ClaudeModelChoice } from '@/lib/ai/claude-model';
import { InspectorSelect } from './inspector-select';
import './assistant-model-picker.css';

const descriptions = { haiku: 'Fast, simple edits', sonnet: 'Everyday editing', opus: 'Complex, coordinated edits' };
const options = CLAUDE_EDIT_MODELS.map(model => ({ value: model.id, label: model.label, description: descriptions[model.id] }));

export function AssistantModelPicker({ value, onChange, disabled }: {
  value: ClaudeModelChoice;
  onChange: (value: ClaudeModelChoice) => void;
  disabled: boolean;
}) {
  return <div className="assistant-model-picker"><InspectorSelect label="AI editing model" value={value} options={options} onChange={onChange} disabled={disabled}/></div>;
}
