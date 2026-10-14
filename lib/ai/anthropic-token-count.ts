import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { AssistantTokenBudgetError } from './token-budget';

/** Use the installed SDK's own encoder without issuing a generation request. */
export async function encodeAnthropicCount(params:LanguageModelV4CallOptions,modelId:string) {
  let body:Record<string,unknown>|undefined;
  const serializer=createAnthropic({apiKey:'local-serialization-only',fetch:async(_url,init)=>{
    body=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({id:'serialization-only',type:'message',role:'assistant',model:modelId,content:[{type:'text',text:'encoded'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}),{status:200,headers:{'Content-Type':'application/json'}});
  }})(modelId);
  await serializer.doGenerate(params);
  if(!body)throw new AssistantTokenBudgetError('usage');
  return Object.fromEntries(['model','system','messages','tools','thinking','tool_choice'].filter(key=>body![key]!==undefined).map(key=>[key,body![key]]));
}
/** Token counting is free; generation remains guarded by the run's token budget.
 * The endpoint returns an estimate, so reserve a margin before each paid call.
 * https://platform.claude.com/docs/en/build-with-claude/token-counting
 */
export function anthropicTokenCounter(modelId:string,key:string) {
  return async(params:LanguageModelV4CallOptions)=>{
    const body=await encodeAnthropicCount(params,modelId);
    const response=await fetch('https://api.anthropic.com/v1/messages/count_tokens',{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01','x-api-key':key},body:JSON.stringify(body),signal:params.abortSignal});
    if(!response.ok)throw Object.assign(new AssistantTokenBudgetError('usage'),{statusCode:response.status});
    const result=await response.json() as {input_tokens?:unknown};
    if(typeof result.input_tokens!=='number'||!Number.isSafeInteger(result.input_tokens)||result.input_tokens<0)throw new AssistantTokenBudgetError('usage');
    return Math.ceil(result.input_tokens*11/10)+4096;
  };
}
