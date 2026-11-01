import { chatAgent } from './chat_data';
import {saveMessages} from '@convex-dev/agent';
import {components} from '../_generated/api';
import {ConvexError} from 'convex/values';
import type {MutationCtx} from '../_generated/server';
import type {TimelinePublicationReceipt} from '../../lib/ai/publication-receipt';

/** The Agent SDK preserves this server-generated metadata on persisted UI text parts. */
export async function savePublicationReceipt(ctx:MutationCtx,ownerId:string,receipt:TimelinePublicationReceipt){
  const [prompt]=await ctx.runQuery(components.agent.messages.getMessagesByIds,{messageIds:[receipt.promptMessageId]});
  if(!prompt||prompt.threadId!==receipt.threadId||prompt.message?.role!=='user')throw new ConvexError('Publication prompt does not match this conversation.');
  await saveMessages(ctx,chatAgent,{
    threadId:receipt.threadId,userId:ownerId,promptMessageId:receipt.promptMessageId,agentName:'Revline',
    messages:[{role:'assistant',content:receipt.status==='saved'?'Your replacement edit is saved.':receipt.status==='aborted'?'Your pending replacement was cancelled.':'Your pending replacement was not saved.'}],
    metadata:[{providerMetadata:{revline:{publicationReceipt:receipt}}}],
  });
}
