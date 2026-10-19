import {userError} from '@/lib/user-error';
import type {ChatMessage,ResultCard,TimelinePublicationReceipt} from './assistant-results';

const fallback='This step could not finish. Your saved edits remain.';
/** Tool transport strings are diagnostics, not copy for the conversation. */
export function assistantErrorDetail(value:string|undefined):string {
  if(!value||/^(?:An error occurred[.!]?|Error|Unknown error|This step could not finish[.!]?)$/i.test(value.trim()))return fallback;
  if(/\bTimelineGestureRejection:\s*Overlaps a clip\b/i.test(value))return 'These clips would overlap. This edit was not saved; previously saved edits remain.';
  if(/timeline changed elsewhere|timeline changed while|revision conflict/i.test(value))return 'Your timeline changed while this edit was being prepared. This change was not saved. Previously saved edits remain.';
  if(/\[CONVEX|ConvexError:|Request ID:|Server Error|\bUncaught\b/.test(value))return fallback;
  return userError(new Error(value),fallback);
}

function failureSummary(text:string):boolean {
  return /^No timeline changes were saved\.(?:\s|$)/.test(text)||/^\d+ (?:edits were saved before the assistant stopped|changes? (?:were|was) saved)\.(?:\s|$)/.test(text);
}
const receiptFailureText=new Set(['Your pending replacement was not saved.','Your pending replacement was cancelled.']);

/** A turn has one failure surface; saved results and the assistant's actual answer stay visible. */
export function assistantTurnPresentation(replies:readonly ChatMessage[],cards:readonly ResultCard[],{error,receipt,active=false}:{error?:string|null;receipt?:TimelinePublicationReceipt;active?:boolean}={}) {
  // A tool rejection is recoverable while the agent is still working. Publish
  // one terminal failure only after the run stops, or the server confirms it.
  if(active&&!error&&receipt?.status!=='failed'&&receipt?.status!=='aborted')return {replies,cards:cards.filter(card=>card.state!=='error')};
  const summaries=replies.flatMap(message=>message.text.split(/\n\s*\n/).filter(failureSummary));
  const failures=cards.filter(card=>card.state==='error');
  const failed=!!error||failures.length>0||summaries.length>0||receipt?.status==='failed'||receipt?.status==='aborted';
  if(!failed)return {replies,cards};
  const summaryDetails=summaries.map(text=>text.replace(/^(?:No timeline changes were saved\.|\d+ (?:edits were saved before the assistant stopped|changes? (?:were|was) saved)\.)\s*/, '').replace(/^Undo restores the state before the latest consecutive group of AI edits\.\s*/, ''));
  const detailCandidates=[error,...summaryDetails,...failures.map(card=>card.detail)].filter((value):value is string=>!!value);
  const conflict=detailCandidates.find(value=>/timeline changed elsewhere|timeline changed while|revision conflict/i.test(value));
  const savedIds=new Set(replies.flatMap(message=>(message.steps??[]).flatMap((step,index)=>step.state==='done'&&step.output?.saved===true?[step.id??`${message.id}:${index}`]:[])));
  const reportedSaved=summaries.reduce((count,text)=>Math.max(count,Number(/^(\d+) (?:edits|changes?)/.exec(text)?.[1]??0)),0);
  const savedChanges=Math.max(savedIds.size,reportedSaved);
  const hasDraft=!!receipt||replies.some(message=>message.steps?.some(step=>step.staged||step.output?.staged===true));
  const specific=detailCandidates.find(value=>assistantErrorDetail(value)!==fallback&&!failureSummary(value)&&!/^This step did not confirm|^No saved confirmation|^The replacement edit was not saved|^No timeline changes were saved/i.test(value));
  let detail=conflict?assistantErrorDetail(conflict):specific?assistantErrorDetail(specific):receipt&&receipt.status!=='saved'?'This replacement was not saved. Previously saved edits remain.':assistantErrorDetail(detailCandidates[0]);
  if(savedChanges&&!hasDraft&&!conflict){
    if(detail===fallback||/pending replacement|edits were saved before the assistant stopped/.test(detail))detail='The request did not finish. Continue the unfinished part from the current timeline.';
  }
  detail=detail.replace('Some requested changes were not saved. Inspect the current timeline before continuing; previously saved edits remain.','Some steps remain unfinished. Your saved edits are still here.');
  if(savedChanges)detail=`${savedChanges} ${savedChanges===1?'change was':'changes were'} saved. ${detail}`;
  const unconfirmed=!error&&!summaries.length&&!receipt&&failures.every(card=>card.title==='Save not confirmed');
  return {
    replies:replies.map(message=>({...message,text:message.text.split(/\n\s*\n/).filter(text=>!failureSummary(text)&&!receiptFailureText.has(text.trim())).join('\n\n')})),
    cards:[...cards.filter(card=>card.state!=='error'&&card.state!=='running'),{key:'turn-failure',title:detail.includes('Some footage checks could not complete.')?'Footage check incomplete':unconfirmed?'Save not confirmed':savedChanges?'Edit partially completed':'Some steps are unfinished',detail,state:'error' as const}],
  };
}
