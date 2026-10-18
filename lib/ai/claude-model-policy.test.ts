import {expect,test} from 'vitest';
import {allowedClaudeModelChoices,enforceClaudeModelPolicy} from './claude-model-policy';

test('editor allowlist stays GPT-only with old flags and with missing credentials',()=>{
  for(const env of [{},{EDITOR_ALLOW_OPUS:'true',ANTHROPIC_API_KEY:'fixture-only'},{AI_GATEWAY_ENABLED:'true',OPENAI_API_KEY:'fixture-only'}])expect(allowedClaudeModelChoices(env)).toEqual(['gpt-6.1-sol','gpt-6-astra']);
});
test('stale Claude and gateway selections cannot bypass active editing policy',()=>{
  for(const provider of ['anthropic','gateway'] as const)for(const modelId of ['claude-haiku-5-5','claude-sonnet-5-5','anthropic/claude-opus-5.5'])expect(()=>enforceClaudeModelPolicy({provider,modelId},{ANTHROPIC_API_KEY:'fixture-only',OPENAI_API_KEY:'fixture-only',EDITOR_ALLOW_OPUS:'true'})).toThrow('supports GPT');
});
test('supported GPT choices need their backend key and never fall back to another provider',()=>{
  for(const key of [undefined,'','   '])expect(()=>enforceClaudeModelPolicy({provider:'openai',modelId:'gpt-6.1-sol'},{OPENAI_API_KEY:key,ANTHROPIC_API_KEY:'fixture-only'})).toThrow('OPENAI_API_KEY');
  expect(enforceClaudeModelPolicy({provider:'openai',modelId:'gpt-6-astra'},{OPENAI_API_KEY:'fixture-only'}).modelId).toBe('gpt-6-astra');
});
