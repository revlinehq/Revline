'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '@/convex/_generated/api';
import { EDITOR_MODELS, EDITOR_REASONING_EFFORTS, normalizeEditorReasoningEffort, type ClaudeModelChoice, type EditorReasoningEffort } from '@/lib/ai/claude-model';
import { PRODUCTION_CLAUDE_MODEL_CHOICES } from '@/lib/ai/claude-model-policy';
import { AssistantModelPicker } from './assistant-model-picker';

type ComposerSettings = Partial<Omit<FunctionReturnType<typeof api.assistant.composerSettings>, 'allowedModels' | 'catalogModels' | 'defaultModelChoice'>> & { catalogModels?: readonly ClaudeModelChoice[]; allowedModels?: readonly ClaudeModelChoice[]; defaultModelChoice?: ClaudeModelChoice };

export function useAssistantComposerControls({ settings, draftKey, disabled }: {
  settings: ComposerSettings; draftKey?: string; disabled: boolean;
}) {
  const [modelChoice, setModelChoice] = useState<ClaudeModelChoice>();
  const [effortChoice, setEffortChoice] = useState<EditorReasoningEffort>();
  const { modelSwitcher, effortSwitcher, claudeViaMcp, defaultModelChoice, defaultReasoningEffort, allowedModels = PRODUCTION_CLAUDE_MODEL_CHOICES } = settings;
  const restricted = settings.paidModelAccess !== true;
  const supportedModels = useMemo(() => EDITOR_MODELS.filter(model => allowedModels.includes(model.id)).map(model => model.id), [allowedModels]);
  const availableModels: readonly typeof EDITOR_MODELS[number]['id'][] = supportedModels.length ? supportedModels : PRODUCTION_CLAUDE_MODEL_CHOICES;
  const selectedModelChoice = availableModels.find(choice => choice === modelChoice);
  const effectiveModelChoice = restricted ? 'gpt-6.1-terra' : selectedModelChoice ?? (availableModels.find(choice => choice === defaultModelChoice) ?? (availableModels.includes('gpt-6.1-sol') ? 'gpt-6.1-sol' : availableModels[0] ?? 'gpt-6.1-sol'));
  const effectiveEffort = restricted ? 'low' : effortChoice ?? normalizeEditorReasoningEffort(defaultReasoningEffort);

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
    {(restricted || modelSwitcher || claudeViaMcp) && <AssistantModelPicker catalogModels={settings.catalogModels} modelAccessNeedsSync={settings.modelAccessNeedsSync} restricted={restricted} claudeViaMcp={claudeViaMcp} allowedModels={modelSwitcher ? availableModels : [effectiveModelChoice]} value={effectiveModelChoice} onChange={chooseModel} disabled={disabled} effort={restricted || modelSwitcher && effortSwitcher ? { value: effectiveEffort, onChange: chooseEffort } : undefined}/>}
  </div>;
  return { actions, request: { modelChoice: restricted ? 'gpt-6.1-terra' : modelSwitcher ? selectedModelChoice : undefined, reasoningEffort: restricted ? 'low' : modelSwitcher && effortSwitcher ? effectiveEffort : undefined } };
}
