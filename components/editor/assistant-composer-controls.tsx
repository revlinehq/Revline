'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '@/convex/_generated/api';
import { EDITOR_MODELS, EDITOR_REASONING_EFFORTS, normalizeEditorReasoningEffort, type ClaudeModelChoice, type EditorReasoningEffort } from '@/lib/ai/claude-model';
import { PRODUCTION_CLAUDE_MODEL_CHOICES } from '@/lib/ai/claude-model-policy';
import { AssistantModelPicker } from './assistant-model-picker';
import { AssistantModePicker, useAssistantEditMode } from './assistant-mode-picker';

type ComposerSettings = Partial<Omit<FunctionReturnType<typeof api.assistant.composerSettings>, 'allowedModels' | 'defaultModelChoice'>> & { allowedModels?: readonly ClaudeModelChoice[]; defaultModelChoice?: ClaudeModelChoice };

export function useAssistantComposerControls({ settings, draftKey, disabled }: {
  settings: ComposerSettings; draftKey?: string; disabled: boolean;
}) {
  const [modelChoice, setModelChoice] = useState<ClaudeModelChoice>();
  const [effortChoice, setEffortChoice] = useState<EditorReasoningEffort>();
  const editMode = useAssistantEditMode();
  const { modelSwitcher, effortSwitcher, claudeViaMcp, defaultModelChoice, defaultReasoningEffort, allowedModels = PRODUCTION_CLAUDE_MODEL_CHOICES } = settings;
  const supportedModels = useMemo(() => EDITOR_MODELS.filter(model => allowedModels.includes(model.id)).map(model => model.id), [allowedModels]);
  const availableModels: readonly typeof EDITOR_MODELS[number]['id'][] = supportedModels.length ? supportedModels : PRODUCTION_CLAUDE_MODEL_CHOICES;
  const selectedModelChoice = availableModels.find(choice => choice === modelChoice);
  const effectiveModelChoice = selectedModelChoice ?? (availableModels.find(choice => choice === defaultModelChoice) ?? (availableModels.includes('gpt-6.1-sol') ? 'gpt-6.1-sol' : availableModels[0] ?? 'gpt-6.1-sol'));
  const effectiveEffort = effortChoice ?? normalizeEditorReasoningEffort(defaultReasoningEffort);

  useEffect(() => {
    try {
      const model = draftKey ? localStorage.getItem(`${draftKey}:model`) : null;
      const effort = draftKey ? sessionStorage.getItem(`${draftKey}:effort`) : null;
      setModelChoice(EDITOR_MODELS.find(item => item.id === model)?.id);
      setEffortChoice(EDITOR_REASONING_EFFORTS.find(item => item === effort));
    } catch { /* Use the deployment defaults when storage is unavailable. */ }
  }, [draftKey]);
  const chooseModel = useCallback((value: ClaudeModelChoice) => {
    setModelChoice(value);
    try { if (draftKey) localStorage.setItem(`${draftKey}:model`, value); } catch { /* The choice holds for this visit. */ }
  }, [draftKey]);
  const chooseEffort = useCallback((value: EditorReasoningEffort) => {
    setEffortChoice(value);
    try { if (draftKey) sessionStorage.setItem(`${draftKey}:effort`, value); } catch { /* The choice holds for this visit. */ }
  }, [draftKey]);

  const actions = <div className="assistant-model-controls">
    {(modelSwitcher || claudeViaMcp) && <AssistantModelPicker claudeViaMcp={claudeViaMcp} allowedModels={modelSwitcher ? availableModels : [effectiveModelChoice]} value={effectiveModelChoice} onChange={chooseModel} disabled={disabled} effort={modelSwitcher && effortSwitcher ? { value: effectiveEffort, onChange: chooseEffort } : undefined}/>}
    <AssistantModePicker value={editMode.value} onChange={editMode.onChange} disabled={disabled}/>
  </div>;
  return { actions, request: { modelChoice: modelSwitcher ? selectedModelChoice : undefined, reasoningEffort: modelSwitcher && effortSwitcher ? effectiveEffort : undefined, editMode: editMode.value } };
}
