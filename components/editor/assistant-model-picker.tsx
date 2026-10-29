'use client';

import { EDITOR_MODELS, type ClaudeModelChoice } from '@/lib/ai/claude-model';
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
