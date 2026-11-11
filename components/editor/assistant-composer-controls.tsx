'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '@/convex/_generated/api';
import { EDITOR_MODELS, EDITOR_REASONING_EFFORTS, FREE_EDITOR_MODEL_CHOICE, type ClaudeModelChoice, type EditorReasoningEffort } from '@/lib/ai/claude-model';
import { AssistantModelPicker } from './assistant-model-picker';

/** What the server tells this user's composer about their plan and the models and efforts it offers them. */
export type ComposerSettings = Partial<Pick<FunctionReturnType<typeof api.assistant.composerSettings>, 'paidModelAccess' | 'modelSwitcher' | 'effortSwitcher' | 'defaultReasoningEffort' | 'allowedEfforts'>> & { allowedModels?: readonly ClaudeModelChoice[]; defaultModelChoice?: ClaudeModelChoice };

type Choice = { model?: ClaudeModelChoice; effort?: EditorReasoningEffort };
const NO_MODELS: readonly ClaudeModelChoice[] = [];
const NO_EFFORTS: readonly EditorReasoningEffort[] = [];
/** One account's pick, kept in this browser across projects and visits. */
const choiceKey = (userId: string) => `revline:composer-model:${userId}`;
function savedChoice(userId: string): Choice {
  const saved: unknown = JSON.parse(localStorage.getItem(choiceKey(userId)) ?? '{}');
  const { model, effort } = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  return { model: EDITOR_MODELS.find(item => item.id === model)?.id, effort: EDITOR_REASONING_EFFORTS.find(item => item === effort) };
}

/**
 * The composer's model and effort pickers and what a message asks the server for.
 * The pickers appear only when the server offers a choice (more than one model or effort), list only what it
 * offers, and the request names exactly what they show, so the turn runs on what the user sees.
 * A plan without paid model access names the free model and low effort, as it always has.
 */
export function useAssistantComposerControls({ settings, disabled }: { settings: ComposerSettings; disabled: boolean }) {
  const { userId } = useAuth();
  const [choice, setChoice] = useState<Choice>({});
  useEffect(() => {
    try { setChoice(userId ? savedChoice(userId) : {}); } catch { setChoice({}); /* Storage is unavailable: the server's defaults apply. */ }
  }, [userId]);
  const choose = (next: Choice) => {
    const value = { ...choice, ...next };
    setChoice(value);
    try { if (userId) localStorage.setItem(choiceKey(userId), JSON.stringify(value)); } catch { /* The choice holds for this visit. */ }
  };

  const restricted = settings.paidModelAccess !== true;
  const offered = !restricted && !!settings.modelSwitcher;
  const models = offered ? settings.allowedModels ?? NO_MODELS : NO_MODELS;
  // A server from before allowedEfforts offers every effort when it sets effortSwitcher.
  const efforts = offered && settings.effortSwitcher ? settings.allowedEfforts ?? EDITOR_REASONING_EFFORTS : NO_EFFORTS;
  const model = models.find(id => id === choice.model) ?? models.find(id => id === settings.defaultModelChoice) ?? models[0];
  const effort = efforts.find(value => value === choice.effort) ?? (efforts.length ? efforts.find(value => value === settings.defaultReasoningEffort) ?? efforts[0] : settings.defaultReasoningEffort);
  const shown = !!model && !!effort && (models.length > 1 || efforts.length > 1);

  const actions = shown ? <AssistantModelPicker model={model} models={models} onModel={value => choose({ model: value })} effort={effort} efforts={efforts.length ? efforts : [effort]} onEffort={value => choose({ effort: value })} disabled={disabled}/> : undefined;
  const request: { modelChoice?: ClaudeModelChoice; reasoningEffort?: EditorReasoningEffort } = restricted ? { modelChoice: FREE_EDITOR_MODEL_CHOICE, reasoningEffort: 'low' } : shown ? { modelChoice: model, ...(efforts.length > 1 ? { reasoningEffort: effort } : {}) } : {};
  return { actions, request };
}
