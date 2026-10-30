'use client';

import { EDITOR_MODELS, EDITOR_REASONING_EFFORTS, type ClaudeModelChoice, type EditorReasoningEffort } from '@/lib/ai/claude-model';
import { ClaudeLogo, GoogleLogo, McpLogo, OpenAILogo } from '@/components/workspace/ai-app-logos';
import { InspectorSelect } from './inspector-select';
import './assistant-model-picker.css';

/** The provider's mark beside each model. */
const providerLogo = (id: ClaudeModelChoice) => id.startsWith('gpt') ? <OpenAILogo className="assistant-model-logo" /> : id.startsWith('gemini') ? <GoogleLogo className="assistant-model-logo" /> : <ClaudeLogo className="assistant-model-logo" />;


/** On a free trial these run only through MCP (Claude Code, Claude Desktop), not in the editor chat. */
const MCP_ONLY_ON_TRIAL: readonly ClaudeModelChoice[] = ['opus', 'sonnet'];

export function AssistantModelPicker({ value, onChange, disabled, allowedModels, freeTrial = false }: {
  value: ClaudeModelChoice;
  onChange: (value: ClaudeModelChoice) => void;
  disabled: boolean;
  allowedModels: readonly ClaudeModelChoice[];
  freeTrial?: boolean;
}) {
  const options = EDITOR_MODELS.filter(model => allowedModels.includes(model.id) || freeTrial && MCP_ONLY_ON_TRIAL.includes(model.id)).map(model => freeTrial && MCP_ONLY_ON_TRIAL.includes(model.id)
    ? { value: model.id, label: model.label, icon: <McpLogo className="assistant-model-logo" />, description: 'Free trial: available only through MCP', disabled: true }
    : { value: model.id, label: model.label, ...('shortLabel' in model ? { shortLabel: model.shortLabel } : {}), icon: providerLogo(model.id) });
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
