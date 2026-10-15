import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV4CallOptions, LanguageModelV4Usage } from '@ai-sdk/provider';
import { generateText, streamText, wrapLanguageModel, type ModelMessage } from 'ai';
import { expect, test } from 'vitest';
import { claudeProviderOptions, editorProviderOptions, CLAUDE_MODEL } from './claude-model';
import { AssistantTokenBudget, EDITOR_RAW_INPUT_LIMIT, EDITOR_TOKEN_LIMITS } from './token-budget';
import { EDITOR_CONTEXT_BOUNDARY } from './editor-context';

function fixture(input = 10, output = 10) {
  const requests: Record<string, unknown>[] = [];
  const provider = createAnthropic({ apiKey: 'fixture-only', fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body)); requests.push(request);
    const usage = { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0},service_tier:'standard',speed:'standard',inference_geo:'global' };
    if (request.stream) {
      const events = [
        ['message_start', { type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', model: CLAUDE_MODEL, content: [], usage } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fixture response' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage }],
        ['message_stop', { type: 'message_stop' }],
      ].map(([name, event]) => `event: ${name}\ndata: ${JSON.stringify(event)}\n\n`).join('');
      return new Response(events, { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: CLAUDE_MODEL, content: [{ type: 'text', text: 'Fixture response' }], stop_reason: 'end_turn', stop_sequence: null, usage }), { headers: { 'content-type': 'application/json' } });
  } });
  return { requests, provider };
}
const usage = (input: number | undefined, output: number | undefined): LanguageModelV4Usage => ({ inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: output, text: output, reasoning: 0 } });
const params: LanguageModelV4CallOptions = { prompt: [{ role: 'user', content: [{ type: 'text', text: 'Fixture' }] }], maxOutputTokens: 100 };

test('actual serialized SDK requests cache the stable system prefix and compact repeated snapshots', async () => {
  const f = fixture(); const budget = new AssistantTokenBudget();
  const model = wrapLanguageModel({ model: f.provider(CLAUDE_MODEL), middleware: budget.middleware() });
  const timeline = { fps: 30, aspectRatio: 'landscape', clips: [{ id: 'source', kind: 'video', sourceStart: 11.5, start: 1.69, duration: 3, playbackRate: .75, motion: Array.from({ length: 2000 }, (_, i) => ({ time: i, scale: 1 })) }] };
  const messages: ModelMessage[] = [];
  for (let i = 0; i < 3; i++) {
    messages.push({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: `read${i}`, toolName: 'inspectTimeline', input: {} }] });
    messages.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: `read${i}`, toolName: 'inspectTimeline', output: { type: 'json', value: { timeline, revision: i } } }] });
    await generateText({ model, system: 'Stable tools and rules' + EDITOR_CONTEXT_BOUNDARY + 'Selected source', messages, providerOptions: claudeProviderOptions('anthropic/claude-sonnet-5.5') });
  }
  const body = f.requests.at(-1)!;
  expect(body.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
  expect(body.system).toMatchObject([{ text: 'Stable tools and rules', cache_control: { type: 'ephemeral', ttl: '5m' } }, { text: EDITOR_CONTEXT_BOUNDARY + 'Selected source' }]);
  const serialized = JSON.stringify(body);
  expect(serialized).toContain('motionSummary'); expect(serialized).toContain('11.5'); expect(serialized).toContain('0.75');
  expect(serialized).not.toContain('1999'); expect(serialized.length).toBeLessThan(4000);
  expect(body.max_tokens).toBe(EDITOR_TOKEN_LIMITS.outputPerCall);
  for (let i = 1; i < f.requests.length; i++) {
    const previous = f.requests[i - 1].messages as unknown[];
    expect((f.requests[i].messages as unknown[]).slice(0, previous.length)).toEqual(previous);
    expect(f.requests[i].system).toEqual(f.requests[i - 1].system);
  }
});

test.each(['generate', 'stream'])('cumulative usage stops the next %s request before paid network work', async method => {
  const f = fixture(50, 20); const budget = new AssistantTokenBudget({ ...EDITOR_TOKEN_LIMITS, inputTokens: 7000, outputTokens: 120, outputPerCall: 100 });
  const model = wrapLanguageModel({ model: f.provider(CLAUDE_MODEL), middleware: budget.middleware() });
  const invoke = async () => {
    if (method === 'generate') await generateText({ model, prompt: 'Fixture', maxOutputTokens: 100, maxRetries: 0 });
    else { let error: unknown; const result = streamText({ model, prompt: 'Fixture', maxOutputTokens: 100, maxRetries: 0, onError: event => { error = event.error; } }); await result.consumeStream(); try { return await result.text; } catch (wrapped) { throw error ?? wrapped; } }
  };
  await invoke(); await invoke();
  expect(budget.usage).toEqual({ inputTokens: 100, outputTokens: 40 });
  await expect(invoke()).rejects.toThrow('token budget');
  expect(f.requests).toHaveLength(2);
});

test('oversized essential observations stop before the first serialized provider request', async () => {
  const f = fixture(); const budget = new AssistantTokenBudget({ ...EDITOR_TOKEN_LIMITS, requestBytes: 500 });
  const model = wrapLanguageModel({ model: f.provider(CLAUDE_MODEL), middleware: budget.middleware() });
  await expect(generateText({ model, prompt: 'Preserve visual evidence '.repeat(100), maxRetries: 0 })).rejects.toThrow('context is too large');
  expect(f.requests).toHaveLength(0);
});

test('three before/peak/after images survive actual serialization and are reserved as images, not base64 text', async () => {
  const f = fixture(); const budget = new AssistantTokenBudget();
  const model = wrapLanguageModel({ model: f.provider(CLAUDE_MODEL), middleware: budget.middleware() });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  await generateText({ model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect source asset at 11.5, 12 and 12.5 seconds. Preserve this trim.' }, ...[1, 2, 3].map(() => ({ type: 'file' as const, data: { type: 'data' as const, data: image }, mediaType: 'image/png' }))] }], maxRetries: 0 });
  const body = f.requests[0];
  expect(JSON.stringify(body)).toContain('11.5');
  const content = (body.messages as { content: { type: string }[] }[])[0].content;
  expect(content.filter(part => part.type === 'image')).toHaveLength(3);
});

test('preflight reservation survives missing usage, failed calls, and concurrent reservations', () => {
  const budget = new AssistantTokenBudget({ ...EDITOR_TOKEN_LIMITS, inputTokens: 5000, outputTokens: 300, outputPerCall: 100 });
  const settle = budget.reserve(params);
  expect(() => budget.reserve(params)).toThrow('token budget');
  settle(usage(undefined, 1));
  expect(() => budget.reserve(params)).toThrow('reliable token usage');
  const other = new AssistantTokenBudget({ ...EDITOR_TOKEN_LIMITS, inputTokens: 5000 });
  other.reserve(params); // Simulate a provider failure without a finish/usage.
  expect(() => other.reserve(params)).toThrow('token budget');
});

test('the five measured native Sonnet steps leave room for the sixth despite repeated cached context',async()=>{
  const measured=[
    [4,0,49891,30],[2,49891,450,180],[2,50341,365,73],[2,50706,256,75],[2,50962,265,73],[2,51227,200,20],
  ];let calls=0;
  const provider=createAnthropic({apiKey:'fixture-only',fetch:async()=>{
    const [input,read,write,output]=measured[calls++];
    const measuredUsage={input_tokens:input,output_tokens:output,cache_read_input_tokens:read,cache_creation_input_tokens:write,cache_creation:{ephemeral_5m_input_tokens:write,ephemeral_1h_input_tokens:0},service_tier:'standard',speed:'standard',inference_geo:'global'};
    const events=[['message_start',{type:'message_start',message:{id:'fixture',type:'message',role:'assistant',model:CLAUDE_MODEL,content:[],usage:measuredUsage}}],['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:measuredUsage}],['message_stop',{type:'message_stop'}]].map(([name,event])=>`event: ${name}\ndata: ${JSON.stringify(event)}\n\n`).join('');
    return new Response(events,{headers:{'content-type':'text/event-stream'}});
  }});
  const budget=new AssistantTokenBudget(),model=wrapLanguageModel({model:provider(CLAUDE_MODEL),middleware:budget.middleware([],0,async()=>59000)});
  const invoke=async()=>{const result=await model.doStream({...params,maxOutputTokens:4096,providerOptions:claudeProviderOptions(CLAUDE_MODEL)}),reader=result.stream.getReader();while(!(await reader.read()).done){/* Consume the real SDK finish/usage. */}};
  for(let step=0;step<5;step++)await invoke();
  expect(budget.usage).toEqual({inputTokens:253139,outputTokens:431});
  await invoke();
  expect(calls).toBe(6);expect(budget.usage).toEqual({inputTokens:304568,outputTokens:451});
});

const nativeSonnet={provider:'anthropic.messages',modelId:CLAUDE_MODEL};
const cachedParams={...params,providerOptions:claudeProviderOptions(CLAUDE_MODEL)};
function cachedUsage(total=50000):LanguageModelV4Usage {
  return {inputTokens:{total,noCache:0,cacheRead:total,cacheWrite:0},outputTokens:{total:10,text:10,reasoning:0},raw:{input_tokens:0,cache_read_input_tokens:total,cache_creation_input_tokens:0,output_tokens:10,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0},service_tier:'standard',speed:'standard',inference_geo:'global'}};
}
test('each cache-eligible request reserves full worst-write cost before any usage refund',()=>{
  const budget=new AssistantTokenBudget({...EDITOR_TOKEN_LIMITS,inputTokens:75000});
  budget.reserve(cachedParams,60000,nativeSonnet);
  expect(budget.usage.inputTokens).toBe(60000);
  expect(()=>budget.reserve(cachedParams,1,nativeSonnet)).toThrow('token budget');
  expect(EDITOR_TOKEN_LIMITS.inputTokens*4/1e6+EDITOR_TOKEN_LIMITS.outputTokens*15/1e6).toBe(1.38);
  expect(1.38).toBeLessThan(1.68);
});
test('cached usage cannot evade the separate raw-token ceiling',()=>{
  const budget=new AssistantTokenBudget({...EDITOR_TOKEN_LIMITS,inputTokens:1_000_000});
  for(let i=0;i<3;i++)budget.reserve(cachedParams,300000,nativeSonnet)(cachedUsage(300000));
  expect(budget.usage.inputTokens).toBe(900000);expect(EDITOR_RAW_INPUT_LIMIT).toBe(1_000_000);
  expect(()=>budget.reserve(cachedParams,300000,nativeSonnet)).toThrow('token budget');
});
test.each([
  {speed:'fast'},{speed:'standard'},{inferenceGeo:'us'},{serviceTier:'auto'},{fallbacks:'default'},{cacheControl:{type:'ephemeral',ttl:'1h'}},{compaction:{enabled:true}},
])('unreviewed Anthropic tariff %j is refused before generation',async override=>{
  const f=fixture(),model=wrapLanguageModel({model:f.provider(CLAUDE_MODEL),middleware:new AssistantTokenBudget().middleware([],0,async()=>60000)});
  await expect(model.doGenerate({...cachedParams,providerOptions:{anthropic:{...cachedParams.providerOptions!.anthropic,...override}}})).rejects.toThrow('reliable token usage');
  expect(f.requests).toHaveLength(0);
});
test('message-level one-hour cache overrides are refused before generation',async()=>{
  const f=fixture(),model=wrapLanguageModel({model:f.provider(CLAUDE_MODEL),middleware:new AssistantTokenBudget().middleware()});
  await expect(model.doGenerate({...cachedParams,prompt:[{role:'system',content:'Fixture',providerOptions:{anthropic:{cacheControl:{type:'ephemeral',ttl:'1h'}}}}]})).rejects.toThrow('reliable token usage');
  expect(f.requests).toHaveLength(0);
});
test.each(['output','content'] as const)('tool-result %s one-hour cache override is refused before generation',async location=>{
  const f=fixture(),model=wrapLanguageModel({model:f.provider(CLAUDE_MODEL),middleware:new AssistantTokenBudget().middleware()});
  const options={anthropic:{cacheControl:{type:'ephemeral',ttl:'1h'}}};
  const output=location==='output'?{type:'json' as const,value:{ok:true},providerOptions:options}:{type:'content' as const,value:[{type:'text' as const,text:'Fixture',providerOptions:options}]};
  await expect(model.doGenerate({...cachedParams,prompt:[{role:'tool',content:[{type:'tool-result',toolName:'fixture',toolCallId:'fixture',output}]}]})).rejects.toThrow('reliable token usage');
  expect(f.requests).toHaveLength(0);
});
test.each(['missing-cache','inconsistent','one-hour','fast','region','fallback','output','underestimate'] as const)('unknown or inconsistent %s usage retains the reservation and blocks subsequent calls',kind=>{
  const budget=new AssistantTokenBudget(),received=cachedUsage(kind==='underestimate'?60001:50000);
  if(kind==='missing-cache')delete received.raw!.cache_read_input_tokens;
  if(kind==='inconsistent')received.inputTokens.noCache=1;
  if(kind==='one-hour')received.raw!.cache_creation={ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:1};
  if(kind==='fast')received.raw!.speed='fast';
  if(kind==='region')received.raw!.inference_geo='us';
  if(kind==='fallback')received.raw!.iterations=[{type:'fallback_message'}];
  if(kind==='output')received.outputTokens.total=undefined;
  budget.reserve(cachedParams,60000,nativeSonnet)(received);
  expect(budget.usage).toEqual({inputTokens:60000,outputTokens:100});
  expect(()=>budget.reserve(cachedParams,60000,nativeSonnet)).toThrow('reliable token usage');
});
test.each([{provider:'gateway',modelId:CLAUDE_MODEL},{provider:'anthropic.messages',modelId:'claude-opus-5-5'},{provider:'openai.responses',modelId:'gpt-6-astra'}])('other providers/models retain strict raw accounting: %j',model=>{
  const budget=new AssistantTokenBudget({...EDITOR_TOKEN_LIMITS,inputTokens:120000});
  budget.reserve(cachedParams,60000,model)(cachedUsage());budget.reserve(cachedParams,60000,model)(cachedUsage());
  expect(()=>budget.reserve(cachedParams,60000,model)).toThrow('token budget');
});
const nativeSol={provider:'openai.responses',modelId:'gpt-6.1-sol'};
const solParams:LanguageModelV4CallOptions={...params,providerOptions:editorProviderOptions({provider:'openai',modelId:'gpt-6.1-sol'})};
function solUsage(total=100000):LanguageModelV4Usage {
  return {inputTokens:{total,noCache:0,cacheRead:total,cacheWrite:0},outputTokens:{total:10,text:10,reasoning:0},raw:{input_tokens:total,output_tokens:10,total_tokens:total+10,input_tokens_details:{cached_tokens:total,cache_write_tokens:0}}};
}
test('native Sol Standard30m cached usage permits repeated context within the same conservative bound',()=>{
  const budget=new AssistantTokenBudget();
  for(let i=0;i<4;i++)budget.reserve(solParams,100000,nativeSol)(solUsage(),{openai:{serviceTier:'default'}});
  expect(budget.usage).toEqual({inputTokens:400000,outputTokens:40});
});
test.each(['missing-write','missing-tier','priority','orchestration'] as const)('unverified native Sol %s usage blocks credit and subsequent calls',kind=>{
  const budget=new AssistantTokenBudget(),received=solUsage();
  if(kind==='missing-write')received.raw!.input_tokens_details={cached_tokens:100000};
  if(kind==='orchestration')received.raw!.output_tokens_details={orchestration_output_tokens:1};
  budget.reserve(solParams,100000,nativeSol)(received,kind==='missing-tier'?undefined:{openai:{serviceTier:kind==='priority'?'priority':'default'}});
  expect(budget.usage).toEqual({inputTokens:100000,outputTokens:100});
  expect(()=>budget.reserve(solParams,100000,nativeSol)).toThrow('reliable token usage');
});
test.each([{serviceTier:'fast'},{reasoningMode:'pro'},{promptCacheOptions:{ttl:'1h'}},{previousResponseId:'unmeasured-history'},{conversation:'unmeasured-history'}])('unreviewed native Sol request %j is rejected before reservation',override=>{
  const budget=new AssistantTokenBudget();
  expect(()=>budget.reserve({...solParams,providerOptions:{openai:{...solParams.providerOptions!.openai,...override}}},100000,nativeSol)).toThrow('reliable token usage');
  expect(budget.usage).toEqual({inputTokens:0,outputTokens:0});
});
