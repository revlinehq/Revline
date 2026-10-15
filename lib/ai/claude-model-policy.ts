import type { ClaudeModelChoice, ClaudeModelSelection } from './claude-model';

type ModelPolicyEnvironment = Readonly<Record<string, string | undefined>>;
export const PRODUCTION_CLAUDE_MODEL_CHOICES: readonly ClaudeModelChoice[] = ['haiku', 'sonnet'];
const ALL_CLAUDE_MODEL_CHOICES: readonly ClaudeModelChoice[] = ['haiku', 'sonnet', 'opus'];

export function allowedClaudeModelChoices(env: ModelPolicyEnvironment = process.env): readonly ClaudeModelChoice[] {
  const claude = env.EDITOR_ALLOW_OPUS === 'false' ? PRODUCTION_CLAUDE_MODEL_CHOICES : ALL_CLAUDE_MODEL_CHOICES;
  return env.OPENAI_API_KEY?.trim() ? [...claude, 'gpt-6.1-sol', 'gpt-6-astra'] : claude;
}

export function enforceClaudeModelPolicy(selection: ClaudeModelSelection, env: ModelPolicyEnvironment = process.env): ClaudeModelSelection {
  if (selection.provider === 'openai' && !env.OPENAI_API_KEY?.trim()) throw new Error('OpenAI editing requires OPENAI_API_KEY in this Convex environment. Choose Sonnet or configure the backend key.');
  if (env.EDITOR_ALLOW_OPUS === 'false' && (selection.modelChoice === 'opus' || /(?:^|\/)claude-opus(?:-|\.)/.test(selection.modelId))) {
    throw new Error('Opus is available only in development. Choose Sonnet 5.5 for this workspace.');
  }
  return selection;
}
