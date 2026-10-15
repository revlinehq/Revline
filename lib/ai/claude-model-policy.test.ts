import { expect, test } from 'vitest';
import { allowedClaudeModelChoices, enforceClaudeModelPolicy } from './claude-model-policy';

test('production policy excludes Opus, including captured choices and configured overrides', () => {
  const env = { EDITOR_ALLOW_OPUS: 'false' };
  expect(allowedClaudeModelChoices(env)).toEqual(['haiku', 'sonnet']);
  for (const modelId of ['claude-opus-5-5', 'anthropic/claude-opus-5.5', 'claude-opus-4-6']) {
    expect(() => enforceClaudeModelPolicy({ provider: 'anthropic', modelId }, env)).toThrow('development');
  }
  expect(() => enforceClaudeModelPolicy({ provider: 'anthropic', modelId: 'claude-sonnet-5-5', modelChoice: 'opus' }, env)).toThrow('development');
  expect(enforceClaudeModelPolicy({ provider: 'anthropic', modelId: 'claude-sonnet-5-5' }, env).modelId).toBe('claude-sonnet-5-5');
});

test('development retains all three choices', () => {
  expect(allowedClaudeModelChoices({ EDITOR_ALLOW_OPUS: 'true' })).toEqual(['haiku', 'sonnet', 'opus']);
  expect(enforceClaudeModelPolicy({ provider: 'anthropic', modelId: 'claude-opus-5-5', modelChoice: 'opus' }, { EDITOR_ALLOW_OPUS: 'true' }).modelChoice).toBe('opus');
});

test('OpenAI availability requires a nonempty backend key and never changes the Opus policy', () => {
  for (const key of [undefined, '', '   ']) expect(allowedClaudeModelChoices({ OPENAI_API_KEY: key, EDITOR_ALLOW_OPUS: 'false' })).toEqual(['haiku', 'sonnet']);
  expect(allowedClaudeModelChoices({ OPENAI_API_KEY: 'fixture-only', EDITOR_ALLOW_OPUS: 'false' })).toEqual(['haiku', 'sonnet', 'gpt-6.1-sol', 'gpt-6-astra']);
  expect(allowedClaudeModelChoices({ OPENAI_API_KEY: 'fixture-only', EDITOR_ALLOW_OPUS: 'true' })).toEqual(['haiku', 'sonnet', 'opus', 'gpt-6.1-sol', 'gpt-6-astra']);
  expect(() => enforceClaudeModelPolicy({ provider: 'openai', modelId: 'gpt-6-astra' }, {})).toThrow('OPENAI_API_KEY');
});
