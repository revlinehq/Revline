import { afterEach,expect,test,vi } from 'vitest';
import { anthropicTokenCounter,encodeAnthropicCount } from './anthropic-token-count';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { wrapLanguageModel } from 'ai';
import { AssistantTokenBudget,EDITOR_TOKEN_LIMITS } from './token-budget';
const params:LanguageModelV4CallOptions={prompt:[{role:'system',content:'Stable rules'},{role:'user',content:[{type:'text',text:'Add a flash'}]}],maxOutputTokens:4096,tools:[{type:'function',name:'apply',description:'Save an edit',inputSchema:{type:'object',properties:{}}}],providerOptions:{anthropic:{thinking:{type:'adaptive'},effort:'medium',cacheControl:{type:'ephemeral',ttl:'5m'}}}};
afterEach(()=>vi.unstubAllGlobals());
test('the installed SDK encodes counting inputs without making a generation request',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const encoded=await encodeAnthropicCount(params,'claude-sonnet-5-5');
  expect(fetch).not.toHaveBeenCalled();expect(encoded).toMatchObject({model:'claude-sonnet-5-5',thinking:{type:'adaptive'},messages:[{role:'user',content:[{type:'text',text:'Add a flash'}]}]});
  expect(encoded).not.toHaveProperty('max_tokens');expect(encoded).not.toHaveProperty('stream');
});
test('free counted reservations allow multiple steps while stopping before the paid call exceeding the run budget',async()=>{
  const requests:string[]=[];
  const fetch=vi.fn(async(url:RequestInfo|URL)=>{
    const counting=String(url).endsWith('/count_tokens');requests.push(counting?'count':'generate');
    return new Response(JSON.stringify(counting?{input_tokens:1000}:{id:'fixture',type:'message',role:'assistant',model:'claude-sonnet-5-5',content:[{type:'text',text:'Saved'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1200,output_tokens:10}}),{status:200,headers:{'Content-Type':'application/json'}});
  });vi.stubGlobal('fetch',fetch);
  const budget=new AssistantTokenBudget({...EDITOR_TOKEN_LIMITS,inputTokens:8000});
  const model=wrapLanguageModel({model:createAnthropic({apiKey:'fixture-only',fetch})('claude-sonnet-5-5'),middleware:budget.middleware([],0,anthropicTokenCounter('claude-sonnet-5-5','fixture-only'))});
  for(let step=0;step<3;step++)await model.doGenerate({...params,maxOutputTokens:64});
  await expect(model.doGenerate({...params,maxOutputTokens:64})).rejects.toThrow('token budget');
  expect(requests).toEqual(['count','generate','count','generate','count','generate','count']);
  expect(budget.usage).toEqual({inputTokens:3600,outputTokens:30});
});
test('free preflight reserves a margin and refuses missing or unavailable counts',async()=>{
  const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({input_tokens:50_000}),{status:200}));vi.stubGlobal('fetch',fetch);
  expect(await anthropicTokenCounter('claude-sonnet-5-5','fixture-only')(params)).toBe(59_096);
  expect(fetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages/count_tokens');
  fetch.mockImplementation(async()=>new Response('{}',{status:200}));await expect(anthropicTokenCounter('claude-sonnet-5-5','fixture-only')(params)).rejects.toThrow('reliable token usage');
  fetch.mockImplementation(async()=>new Response('{}',{status:429}));await expect(anthropicTokenCounter('claude-sonnet-5-5','fixture-only')(params)).rejects.toThrow('reliable token usage');
});
