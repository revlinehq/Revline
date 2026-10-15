import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { expect, test } from 'vitest';
import { CLAUDE_EDIT_MODELS, CLAUDE_GATEWAY_MODEL, CLAUDE_MODEL, claudeModelSwitcherEnabled, claudeProviderOptions, resolveClaudeModel, validatePinnedClaudeModel, type ClaudeModelChoice } from './claude-model';

test('unselected requests preserve configured provider and model overrides', () => {
  expect(resolveClaudeModel(undefined, {})).toEqual({ provider: 'anthropic', modelId: CLAUDE_MODEL });
  expect(resolveClaudeModel(undefined, { AI_GATEWAY_ENABLED: 'true' })).toEqual({ provider: 'gateway', modelId: CLAUDE_GATEWAY_MODEL });
  expect(resolveClaudeModel(undefined, { CLAUDE_MODEL: 'claude-existing-override' })).toEqual({ provider: 'anthropic', modelId: 'claude-existing-override' });
  expect(resolveClaudeModel(undefined, { AI_GATEWAY_ENABLED: 'true', CLAUDE_GATEWAY_MODEL: 'anthropic/configured-model' })).toEqual({ provider: 'gateway', modelId: 'anthropic/configured-model' });
});

test.each(CLAUDE_EDIT_MODELS)('$label only overrides the model when manual selection is enabled', model => {
  expect(() => resolveClaudeModel(model.id, {})).toThrow('disabled');
  expect(resolveClaudeModel(model.id, { MODEL_SWITCHER_ENABLED: 'true', CLAUDE_MODEL: 'other' })).toEqual({ provider: 'anthropic', modelId: model.modelId, modelChoice: model.id });
  expect(resolveClaudeModel(model.id, { MODEL_SWITCHER_ENABLED: 'true', AI_GATEWAY_ENABLED: 'true', CLAUDE_GATEWAY_MODEL: 'other' })).toEqual({ provider: 'gateway', modelId: model.gatewayModelId, modelChoice: model.id });
});

test('the switcher requires the exact enable flag and rejects unsupported choices', () => {
  expect(claudeModelSwitcherEnabled({ MODEL_SWITCHER_ENABLED: 'false' })).toBe(false);
  expect(claudeModelSwitcherEnabled({ MODEL_SWITCHER_ENABLED: '1' })).toBe(false);
  expect(() => resolveClaudeModel('unsupported' as ClaudeModelChoice, { MODEL_SWITCHER_ENABLED: 'true' })).toThrow('supported');
  expect(() => validatePinnedClaudeModel({ provider: 'anthropic', modelId: CLAUDE_MODEL, modelChoice: 'opus' })).toThrow('does not match');
});

test('a captured selection remains pinned regardless of later environment changes', () => {
  const pinned = resolveClaudeModel('opus', { MODEL_SWITCHER_ENABLED: 'true', AI_GATEWAY_ENABLED: 'true' });
  expect(resolveClaudeModel(undefined, {})).not.toEqual(pinned);
  expect(validatePinnedClaudeModel(pinned)).toEqual({ provider: 'gateway', modelId: 'anthropic/claude-opus-5.5', modelChoice: 'opus' });
  expect(validatePinnedClaudeModel({ provider: 'anthropic', modelId: 'existing-env-override' }).modelId).toBe('existing-env-override');
});

test.each(CLAUDE_EDIT_MODELS)('installed Anthropic SDK sends supported adaptive thinking and drop-block binding for $label', async model => {
  let request: Record<string, unknown> | undefined;
  const provider = createAnthropic({ apiKey: 'fixture-only', fetch: async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'msg_fixture', type: 'message', role: 'assistant', model: model.modelId, content: [{ type: 'text', text: 'Fixture response' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const response = await generateText({ model: provider(model.modelId), prompt: 'Synthetic fixture', providerOptions: claudeProviderOptions(model.modelId), maxOutputTokens: 512 });
  expect(response.text).toBe('Fixture response');
  expect(request).toMatchObject({ model: model.modelId, cache_control: { type: 'ephemeral', ttl: '5m' }, thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }, output_config: { effort: 'medium' } });
  if(model.id==='sonnet'){
    expect(request).toMatchObject({speed:'standard',service_tier:'standard_only',inference_geo:'global'});
    expect(claudeProviderOptions(model.gatewayModelId)?.anthropic).not.toHaveProperty('serviceTier');
  }else expect(claudeProviderOptions(model.gatewayModelId)).toEqual(claudeProviderOptions(model.modelId));
});

test('production policy also blocks environment overrides and previously queued Opus selections', () => {
  const production = { EDITOR_ALLOW_OPUS: 'false', MODEL_SWITCHER_ENABLED: 'true' };
  expect(() => resolveClaudeModel('opus', production)).toThrow('only in development');
  expect(() => resolveClaudeModel(undefined, { ...production, CLAUDE_MODEL: 'claude-opus-5-5' })).toThrow('only in development');
  expect(() => resolveClaudeModel(undefined, { ...production, AI_GATEWAY_ENABLED: 'true', CLAUDE_GATEWAY_MODEL: 'anthropic/claude-opus-5.5' })).toThrow('only in development');
  expect(() => validatePinnedClaudeModel({ provider: 'anthropic', modelId: 'claude-opus-5-5', modelChoice: 'opus' }, production)).toThrow('only in development');
  expect(validatePinnedClaudeModel({ provider: 'anthropic', modelId: CLAUDE_MODEL, modelChoice: 'sonnet' }, production).modelId).toBe(CLAUDE_MODEL);
});

test('older or unrelated configured models retain their prior provider options', () => {
  expect(claudeProviderOptions('claude-sonnet-4-5')).toBeUndefined();
  expect(claudeProviderOptions('unrelated/claude-sonnet-5.5')).toBeUndefined();
});
