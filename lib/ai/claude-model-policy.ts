import type { ClaudeModelChoice, ClaudeModelSelection } from './claude-model';

type ModelPolicyEnvironment = Readonly<Record<string, string | undefined>>;
export const PRODUCTION_CLAUDE_MODEL_CHOICES: readonly ClaudeModelChoice[] = ['haiku', 'sonnet'];
const ALL_CLAUDE_MODEL_CHOICES: readonly ClaudeModelChoice[] = ['haiku', 'sonnet', 'opus'];

export function allowedClaudeModelChoices(env: ModelPolicyEnvironment = process.env): readonly ClaudeModelChoice[] {
  return env.EDITOR_ALLOW_OPUS === 'false' ? PRODUCTION_CLAUDE_MODEL_CHOICES : ALL_CLAUDE_MODEL_CHOICES;
}

export function enforceClaudeModelPolicy(selection: ClaudeModelSelection, env: ModelPolicyEnvironment = process.env): ClaudeModelSelection {
  if (env.EDITOR_ALLOW_OPUS === 'false' && (selection.modelChoice === 'opus' || /(?:^|\/)claude-opus(?:-|\.)/.test(selection.modelId))) {
    throw new Error('Opus is available only in development. Choose Sonnet 5.5 for this workspace.');
  }
  return selection;
}
