import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { expect, test } from 'vitest';
import { CLAUDE_EDIT_MODELS, OPENAI_EDIT_MODELS, EDITOR_MODELS, claudeModelSwitcherEnabled, claudeProviderOptions, resolveClaudeModel, validatePinnedClaudeModel, type ClaudeModelChoice } from './claude-model';

const env={OPENAI_API_KEY:'fixture-only',MODEL_SWITCHER_ENABLED:'true'};
test('active editor defaults to native Sol regardless of old Claude and gateway settings',()=>{
  expect(EDITOR_MODELS).toEqual(OPENAI_EDIT_MODELS);
  for(const overrides of [{},{AI_GATEWAY_ENABLED:'true'},{CLAUDE_MODEL:'claude-opus-5-5',CLAUDE_GATEWAY_MODEL:'anthropic/old'}])expect(resolveClaudeModel(undefined,{...env,...overrides})).toEqual({provider:'openai',modelId:'gpt-6.1-sol',modelChoice:'gpt-6.1-sol'});
  expect(resolveClaudeModel(undefined,{...env,EDITOR_DEFAULT_MODEL:'gpt-6-astra'}).modelId).toBe('gpt-6-astra');
  expect(()=>resolveClaudeModel(undefined,{ANTHROPIC_API_KEY:'fixture-only',AI_GATEWAY_ENABLED:'true'})).toThrow('OPENAI_API_KEY');
});
test.each(OPENAI_EDIT_MODELS)('$label manual requests and captured pins stay OpenAI',model=>{
  expect(()=>resolveClaudeModel(model.id,{...env,MODEL_SWITCHER_ENABLED:'false'})).toThrow('disabled');
  const pinned=resolveClaudeModel(model.id,env);
  expect(validatePinnedClaudeModel(pinned,{...env,EDITOR_DEFAULT_MODEL:'gpt-6-astra',MODEL_SWITCHER_ENABLED:'false',AI_GATEWAY_ENABLED:'true'})).toEqual(pinned);
});
test.each(CLAUDE_EDIT_MODELS)('$label stale selections and queued direct/gateway models are refused clearly',model=>{
  expect(()=>resolveClaudeModel(model.id,env)).toThrow('supports GPT');
  expect(()=>resolveClaudeModel(undefined,{...env,EDITOR_DEFAULT_MODEL:model.id})).toThrow('supports GPT');
  for(const provider of ['anthropic','gateway'] as const)expect(()=>validatePinnedClaudeModel({provider,modelId:provider==='gateway'?model.gatewayModelId:model.modelId,modelChoice:model.id},env)).toThrow('supports GPT');
});
test('unsupported choices, inconsistent pins and nonliteral switcher flags fail closed',()=>{
  expect(claudeModelSwitcherEnabled({MODEL_SWITCHER_ENABLED:'1'})).toBe(false);
  expect(()=>resolveClaudeModel('unsupported' as ClaudeModelChoice,env)).toThrow('supported GPT');
  expect(()=>validatePinnedClaudeModel({provider:'openai',modelId:'gpt-6.1-sol',modelChoice:'gpt-6-astra'},env)).toThrow('does not match');
});

test.each(CLAUDE_EDIT_MODELS)('historical Anthropic SDK sends supported adaptive thinking and drop-block binding for $label', async model => {
  let request: Record<string, unknown> | undefined;
  const provider = createAnthropic({ apiKey: 'fixture-only', fetch: async (_url, init) => {
    request = JSON.parse(String(init?.body));
    if(model.id==='sonnet'&&request?.speed!==undefined)return new Response(JSON.stringify({error:{type:'invalid_request_error',message:"'claude-sonnet-5-5' does not support the `speed` parameter."}}),{status:400,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({ id: 'msg_fixture', type: 'message', role: 'assistant', model: model.modelId, content: [{ type: 'text', text: 'Fixture response' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const response = await generateText({ model: provider(model.modelId), prompt: 'Synthetic fixture', providerOptions: claudeProviderOptions(model.modelId), maxOutputTokens: 512 });
  expect(response.text).toBe('Fixture response');
  expect(request).toMatchObject({ model: model.modelId, cache_control: { type: 'ephemeral', ttl: '5m' }, thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }, output_config: { effort: 'medium' } });
  if(model.id==='sonnet'){
    expect(request).toMatchObject({service_tier:'standard_only',inference_geo:'global'});
    expect(request).not.toHaveProperty('speed');
    expect(claudeProviderOptions(model.gatewayModelId)?.anthropic).not.toHaveProperty('serviceTier');
  }else expect(claudeProviderOptions(model.gatewayModelId)).toEqual(claudeProviderOptions(model.modelId));
});
