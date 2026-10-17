import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';
import { afterEach, expect, test, vi } from 'vitest';
import { encodeOpenAICount, openAITokenCounter } from './openai-token-count';
import { AssistantTokenBudget, editorTokenBudgetEnabled } from './token-budget';
import { editorProviderOptions } from './claude-model';

const modelId='gpt-6.1-sol';
const params:LanguageModelV4CallOptions={prompt:[{role:'system',content:'Preserve source timing.'},{role:'user',content:[{type:'text',text:'Add captions.'}]}],maxOutputTokens:4096,tools:[{type:'function',name:'inspect',description:'Read source evidence',inputSchema:{type:'object',properties:{}}}],providerOptions:editorProviderOptions({provider:'openai',modelId})};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

test('counting preserves the installed SDK tools, images, reasoning and formatting while excluding generation-only controls',async()=>{
  const request:LanguageModelV4CallOptions={...params,headers:{Authorization:'caller-private',unrelated:'caller-private'},responseFormat:{type:'json',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}},prompt:[...params.prompt,{role:'assistant',content:[{type:'reasoning',text:'',providerOptions:{openai:{itemId:'rs_fixture',reasoningEncryptedContent:'fixture-encrypted-reasoning'}}},{type:'tool-call',toolName:'inspect',toolCallId:'call_fixture',input:{}}]},{role:'tool',content:[{type:'tool-result',toolName:'inspect',toolCallId:'call_fixture',output:{type:'json',value:{sourceTime:1.25}}}]},{role:'user',content:[{type:'file',mediaType:'image/png',data:{type:'data',data:'fixture-image-bytes'},providerOptions:{openai:{imageDetail:'high'}}}]}]};
  const requests:{url:string;headers:Headers;body:Record<string,unknown>}[]=[];
  const fetch=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    requests.push({url:String(url),headers:new Headers(init?.headers),body:JSON.parse(String(init?.body))});
    return Response.json(String(url).endsWith('/input_tokens')?{object:'response.input_tokens',input_tokens:50_000}:{id:'fixture-response',output:[]});
  });vi.stubGlobal('fetch',fetch);
  const measurement=vi.fn();
  expect(await openAITokenCounter(modelId,'real-request-key',measurement)(request)).toBe(59_096);
  await createOpenAI({apiKey:'real-request-key',fetch}).responses(modelId).doGenerate(request);
  const [count,generation]=requests;
  expect(count.url).toBe('https://api.openai.com/v1/responses/input_tokens');
  for(const field of Object.keys(count.body))expect(count.body[field]).toEqual(generation.body[field]);
  expect(count.body.tools).toBeDefined();expect(count.body.text).toBeDefined();expect(count.body.reasoning).toBeDefined();
  expect(JSON.stringify(count.body)).toContain('fixture-image-bytes');expect(JSON.stringify(count.body)).toContain('fixture-encrypted-reasoning');
  for(const field of ['store','max_output_tokens','stream','include','prompt_cache_options'])expect(count.body).not.toHaveProperty(field);
  expect(count.headers.get('authorization')).toBe('Bearer real-request-key');expect(count.headers.get('unrelated')).toBeNull();
  expect(JSON.stringify(count.body)).not.toContain('local-serialization-only');
  expect(measurement).toHaveBeenCalledWith({method:'openai-input-tokens',countedTokens:50_000,reservedTokens:59_096});
  fetch.mockClear();await encodeOpenAICount(request,modelId);expect(fetch).not.toHaveBeenCalled();
});

test('the measured two-call Sol case can continue with exact counting while every existing run limit remains unchanged',async()=>{
  const input={...params,prompt:[{role:'user' as const,content:[{type:'text' as const,text:'x'.repeat(190_000)}]}]};
  const measured=[[37136,0,37133,43],[43984,37133,6848,50],[50000,43981,6016,50]];
  let paid=0,counted=0;
  const fetch=vi.fn(async(url:RequestInfo|URL)=>{
    if(String(url).endsWith('/input_tokens')){counted++;return Response.json({object:'response.input_tokens',input_tokens:measured[paid][0]});}
    const [tokens,read,write,output]=measured[paid++];
    return Response.json({id:`fixture-${paid}`,output:[],service_tier:'default',usage:{input_tokens:tokens,input_tokens_details:{cached_tokens:read,cache_write_tokens:write},output_tokens:output,output_tokens_details:{reasoning_tokens:0},total_tokens:tokens+output}});
  });vi.stubGlobal('fetch',fetch);
  const model=createOpenAI({apiKey:'fixture-only',fetch}).responses(modelId),legacy=wrapLanguageModel({model,middleware:new AssistantTokenBudget().middleware()});
  await legacy.doGenerate(input);await legacy.doGenerate(input);
  await expect(legacy.doGenerate(input)).rejects.toThrow('token budget');expect(paid).toBe(2);
  paid=0;
  const budget=new AssistantTokenBudget(),fixed=wrapLanguageModel({model,middleware:budget.middleware([],0,openAITokenCounter(modelId,'fixture-only'))});
  await fixed.doGenerate(input);await fixed.doGenerate(input);await fixed.doGenerate(input);
  expect(paid).toBe(3);expect(counted).toBe(3);expect(budget.usage).toEqual({inputTokens:131120,outputTokens:143});
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({object:'response.input_tokens',input_tokens:300_000})));
  await expect(fixed.doGenerate(input)).rejects.toThrow('token budget');expect(paid).toBe(3);
});

test('an unavailable or malformed count fails closed before any generation and never exposes private provider details',async()=>{
  const bodies=[Response.json({error:{message:'Private provider detail sk_fixture_secret'}},{status:503}),Response.json({object:'response.input_tokens',input_tokens:1.5}),Response.json({object:'response.input_tokens',input_tokens:1_000_001}),Response.json({input_tokens:10})];
  for(const response of bodies){
    const fetch=vi.fn(async(_url:RequestInfo|URL)=>response);vi.stubGlobal('fetch',fetch);
    const model=wrapLanguageModel({model:createOpenAI({apiKey:'fixture-only',fetch}).responses(modelId),middleware:new AssistantTokenBudget().middleware([],0,openAITokenCounter(modelId,'fixture-only'))});
    let failure:unknown;try{await model.doGenerate(params);}catch(error){failure=error;}
    expect(failure).toMatchObject({name:'AssistantTokenBudgetError'});expect((failure as Error).message).not.toContain('Private');expect(JSON.stringify(failure)).not.toContain('sk_fixture_secret');
    expect(fetch).toHaveBeenCalledOnce();expect(String(fetch.mock.calls[0][0])).toContain('/input_tokens');
  }
});

test('normal editing defaults to no financial cutoff or count requests while keeping the per-call output cap',async()=>{
  const counting=vi.fn(async()=>{throw new Error('Counting must stay off.');});
  const requests:Record<string,unknown>[]=[];
  const fetch=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({id:'fixture',output:[],service_tier:'default',usage:{input_tokens:1_000_001,output_tokens:50}});
  });
  const model=wrapLanguageModel({model:createOpenAI({apiKey:'fixture-only',fetch}).responses(modelId),middleware:new AssistantTokenBudget().middleware([],0,counting,editorTokenBudgetEnabled({}))});
  for(let call=0;call<3;call++)await model.doGenerate({...params,maxOutputTokens:100_000});
  expect(counting).not.toHaveBeenCalled();expect(requests).toHaveLength(3);
  expect(requests.every(request=>request.max_output_tokens===4096)).toBe(true);
  expect(editorTokenBudgetEnabled({EDITOR_ENFORCE_TOKEN_BUDGET:'true'})).toBe(true);
  expect(editorTokenBudgetEnabled({EDITOR_ENFORCE_TOKEN_BUDGET:'false'})).toBe(false);
  expect(()=>editorTokenBudgetEnabled({EDITOR_ENFORCE_TOKEN_BUDGET:'1'})).toThrow('must be true or false');
});
