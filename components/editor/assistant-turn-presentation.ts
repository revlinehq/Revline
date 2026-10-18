import {userError} from '@/lib/user-error';
import type {ChatMessage,ResultCard,TimelinePublicationReceipt} from './assistant-results';

const fallback='This step could not finish. Your saved edits remain.';
/** Tool transport strings are diagnostics, not copy for the conversation. */
export function assistantErrorDetail(value:string|undefined):string {
  if(!value)return fallback;
  if(/timeline changed elsewhere|timeline changed while|revision conflict/i.test(value))return 'Your timeline changed while this edit was being prepared. This change was not saved. Previously saved edits remain.';
  if(/\[CONVEX|ConvexError:|Request ID:|Server Error|\bUncaught\b/.test(value))return fallback;
  return userError(new Error(value),fallback);
}

function failureSummary(text:string):boolean {
  return /^No timeline changes were saved\.(?:\s|$)/.test(text)||/^\d+ edits were saved before the assistant stopped\.(?:\s|$)/.test(text);
}
const receiptFailureText=new Set(['Your pending replacement was not saved.','Your pending replacement was cancelled.']);

/** A turn has one failure surface; saved results and the assistant's actual answer stay visible. */
export function assistantTurnPresentation(replies:readonly ChatMessage[],cards:readonly ResultCard[],{error,receipt}:{error?:string|null;receipt?:TimelinePublicationReceipt}={}) {
  const summaries=replies.flatMap(message=>message.text.split(/\n\s*\n/).filter(failureSummary));
  const failures=cards.filter(card=>card.state==='error');
  const failed=!!error||failures.length>0||summaries.length>0||receipt?.status==='failed'||receipt?.status==='aborted';
  if(!failed)return {replies,cards};
  const detailCandidates=[error,...failures.map(card=>card.detail),...summaries].filter((value):value is string=>!!value);
  const conflict=detailCandidates.find(value=>/timeline changed elsewhere|timeline changed while|revision conflict/i.test(value));
  const specific=detailCandidates.find(value=>!/^This step did not confirm|^No saved confirmation|^The replacement edit was not saved|^No timeline changes were saved/i.test(value));
  const detail=conflict?assistantErrorDetail(conflict):specific?assistantErrorDetail(specific):receipt&&receipt.status!=='saved'?'This replacement was not saved. Previously saved edits remain.':assistantErrorDetail(detailCandidates[0]);
  const unconfirmed=!error&&!summaries.length&&!receipt&&failures.every(card=>card.title==='Save not confirmed');
  return {
    replies:replies.map(message=>({...message,text:message.text.split(/\n\s*\n/).filter(text=>!failureSummary(text)&&!receiptFailureText.has(text.trim())).join('\n\n')})),
    cards:[...cards.filter(card=>card.state!=='error'&&card.state!=='running'),{key:'turn-failure',title:unconfirmed?'Save not confirmed':'Could not finish this edit',detail,state:'error' as const}],
  };
}
