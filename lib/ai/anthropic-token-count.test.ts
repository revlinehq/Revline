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
  fetch.mockImplementation(async()=>new Response('{}',{status:429}));await expect(anthropicTokenCounter('claude-sonnet-5-5','fixture-only')(params)).rejects.toThrow('rate or usage limit');
});
test.each(['generate','stream'] as const)('insufficient-credit preflight reports the real cause before any paid %s request',async method=>{
  const requests:string[]=[];
  const fetch=vi.fn(async(url:RequestInfo|URL)=>{
    requests.push(String(url));
    return new Response(JSON.stringify({error:{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API. Private provider detail sk_fixture_secret'}}),{status:400});
  });vi.stubGlobal('fetch',fetch);
  const budget=new AssistantTokenBudget();
  const model=wrapLanguageModel({model:createAnthropic({apiKey:'fixture-only',fetch})('claude-sonnet-5-5'),middleware:budget.middleware([],0,anthropicTokenCounter('claude-sonnet-5-5','fixture-only'))});
  const request=method==='generate'?model.doGenerate(params):model.doStream(params);
  await expect(request).rejects.toMatchObject({name:'AssistantTokenBudgetError',statusCode:400,message:'Claude API credits are exhausted. Your saved edits remain. Restore credits in the Claude Console before continuing.'});
  expect(requests).toEqual(['https://api.anthropic.com/v1/messages/count_tokens']);
  expect(budget.usage).toEqual({inputTokens:0,outputTokens:0});
});
test.each([[401,'authentication failed'],[403,'selected model'],[503,'temporarily unavailable']] as const)('count rejection HTTP%i uses a safe recovery message',async(status,expected)=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{message:'Private provider detail sk_fixture_secret'}}),{status})));
  let failure:unknown;try{await anthropicTokenCounter('claude-sonnet-5-5','fixture-only')(params);}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(Error);expect((failure as Error).message).toContain(expected);
  expect(JSON.stringify(failure)).not.toContain('sk_fixture_secret');expect((failure as Error).message).not.toContain('Private provider detail');
});
test.each(['{}','null','{"input_tokens":-1}','{"input_tokens":1.5}','{"input_tokens":"50"}','malformed private provider body'])('invalid successful count %s remains blocked conservatively',async body=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(body,{status:200})));
  await expect(anthropicTokenCounter('claude-sonnet-5-5','fixture-only')(params)).rejects.toThrow('reliable token usage');
});
test('unrecognized count rejection remains fail-closed without retaining provider detail',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{message:'Unknown provider failure sk_fixture_secret'}}),{status:500})));
  await expect(anthropicTokenCounter('claude-sonnet-5-5','fixture-only')(params)).rejects.toMatchObject({name:'AssistantTokenBudgetError',statusCode:500,message:expect.stringContaining('reliable token usage')});
});
