'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '@/convex/_generated/api';
import { EDITOR_MODELS, EDITOR_REASONING_EFFORTS, FREE_EDITOR_MODEL_CHOICE, DEFAULT_EDITOR_MODEL, OPENAI_EDIT_CHOICES, normalizeEditorReasoningEffort, type ClaudeModelChoice, type EditorReasoningEffort } from '@/lib/ai/claude-model';
import { AssistantModelPicker } from './assistant-model-picker';
import { storeDraftEffort, storeDraftModel, storedDraftEffort, storedDraftModel } from '@/lib/editor/opening-request';

/** The model and effort choices the server offers this user's composer. */
export type ComposerSettings = Partial<Omit<FunctionReturnType<typeof api.assistant.composerSettings>, 'allowedModels' | 'catalogModels' | 'defaultModelChoice'>> & { catalogModels?: readonly ClaudeModelChoice[]; allowedModels?: readonly ClaudeModelChoice[]; defaultModelChoice?: ClaudeModelChoice };

export function useAssistantComposerControls({ settings, draftKey, disabled }: {
  settings: ComposerSettings; draftKey?: string; disabled: boolean;
}) {
  const [modelChoice, setModelChoice] = useState<ClaudeModelChoice>();
  const [effortChoice, setEffortChoice] = useState<EditorReasoningEffort>();
  const { modelSwitcher, effortSwitcher, effortLocked, claudeViaMcp, defaultModelChoice, defaultReasoningEffort, allowedModels = OPENAI_EDIT_CHOICES } = settings;
  const restricted = settings.paidModelAccess !== true;
  const supportedModels = useMemo(() => EDITOR_MODELS.filter(model => allowedModels.includes(model.id)).map(model => model.id), [allowedModels]);
  const availableModels: readonly typeof EDITOR_MODELS[number]['id'][] = supportedModels.length ? supportedModels : OPENAI_EDIT_CHOICES;
  const selectedModelChoice = availableModels.find(choice => choice === modelChoice);
  const effectiveModelChoice = restricted ? FREE_EDITOR_MODEL_CHOICE : selectedModelChoice ?? (availableModels.find(choice => choice === defaultModelChoice) ?? (availableModels.includes(DEFAULT_EDITOR_MODEL) ? DEFAULT_EDITOR_MODEL : availableModels[0] ?? DEFAULT_EDITOR_MODEL));
  // Only Ultra (effortSwitcher) picks an effort; a remembered choice does not apply on another plan.
  const planEffort = restricted ? 'low' : normalizeEditorReasoningEffort(defaultReasoningEffort);
  const effortChoosable = !restricted && !!modelSwitcher && !!effortSwitcher;
  const effectiveEffort = effortChoosable ? effortChoice ?? planEffort : planEffort;

  useEffect(() => {
    try {
      const model = draftKey ? storedDraftModel(draftKey) : null;
      const effort = draftKey ? storedDraftEffort(draftKey) : null;
      setModelChoice(EDITOR_MODELS.find(item => item.id === model)?.id);
      setEffortChoice(EDITOR_REASONING_EFFORTS.find(item => item === effort));
    } catch { /* Use the deployment defaults when storage is unavailable. */ }
  }, [draftKey]);
  const chooseModel = useCallback((value: ClaudeModelChoice) => {
    setModelChoice(value);
    try { if (draftKey) storeDraftModel(draftKey, value); } catch { /* The choice holds for this visit. */ }
  }, [draftKey]);
  const chooseEffort = useCallback((value: EditorReasoningEffort) => {
    setEffortChoice(value);
    try { if (draftKey) storeDraftEffort(draftKey, value); } catch { /* The choice holds for this visit. */ }
  }, [draftKey]);

  const actions = <div className="assistant-model-controls">
    {/* Only a server that offers the switcher gets a picker. Without it the server picks the model (Haiku 5.5 in production), so no name is shown that the turn might not run on. */}
    {modelSwitcher && <AssistantModelPicker catalogModels={settings.catalogModels} modelAccessNeedsSync={settings.modelAccessNeedsSync} restricted={restricted} claudeViaMcp={claudeViaMcp} allowedModels={availableModels} value={effectiveModelChoice} onChange={chooseModel} disabled={disabled} effort={effortChoosable || restricted || effortLocked ? { value: effectiveEffort, onChange: chooseEffort, locked: !effortChoosable } : undefined}/>}
  </div>;
  return { actions, request: { modelChoice: restricted ? FREE_EDITOR_MODEL_CHOICE : modelSwitcher ? selectedModelChoice : undefined, reasoningEffort: restricted ? 'low' : effortChoosable ? effectiveEffort : undefined } };
}
