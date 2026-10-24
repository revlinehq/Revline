'use client';
import { ToolChain } from './tool-chain';
import { userError } from '@/lib/user-error';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

import { PRODUCTION_CLAUDE_MODEL_CHOICES } from '@/lib/ai/claude-model-policy';
import { Fragment, memo, useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef, type ComponentProps } from 'react';
import { Check, ArrowUpRight, RotateCcw, X } from 'lucide-react';
import { AssistantModelPicker } from './assistant-model-picker';
import {EDITOR_MODELS,OPENAI_EDIT_MODELS,OPENAI_REASONING_EFFORTS,OPENAI_SPEED_MODES,type ClaudeModelChoice,type OpenAIReasoningEffort,type OpenAISpeedMode} from '@/lib/ai/claude-model';
import {InspectorSelect} from './inspector-select';
import { EditComposer, type ComposerAttachment } from '@/components/workspace/edit-composer';
import {useQuery,useMutation} from 'convex/react';
import { useUIMessages } from '@convex-dev/agent/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { chatMessageFromUI } from './assistant-results';
import {assistantTurnPresentation,assistantErrorDetail} from './assistant-turn-presentation';
import { ChatProse } from './chat-prose';
import { useConversationScroll } from '@/components/workspace/use-conversation-scroll';
import { savedEditComparison, summarizeTools, turnPublicationReceipt, type AssistantEditSnapshot, type ChatMessage } from './assistant-results';
import './assistant-results.css';
import './assistant-editing.css';
import './assistant-panel.css';
import type { SourceEditSuggestion } from '@/lib/editor/types';
import { processingDetail } from './processing-status';
import { AssistantActivity } from './assistant-activity';
import { AssistantTurnCostsProvider, AssistantTurnCostBadge } from './assistant-turn-costs';
import { AssistantHistoryExpansion } from './assistant-history-pagination';
export type { ChatTool, ChatMessage } from './assistant-results';

type Conversation = {projectId:Id<'projects'>;threadId:string};
type PanelProps = ComponentProps<typeof AssistantPanelBody> & {conversation?:Conversation};
type QueuedMessage={id:Id<'assistantQueue'>;prompt:string;error?:string};
type ConversationState = {queued:QueuedMessage[];queuePaused:boolean;onRemoveQueued:(id:Id<'assistantQueue'>)=>Promise<unknown>;onResumeQueue:()=>Promise<unknown>;threadId:string;messages:ChatMessage[];canLoadMore:boolean;onLoadMore:()=>void};
const ConnectedConversation = memo(function ConnectedConversation({conversation,onUpdate}:{conversation:Conversation;onUpdate:(state:ConversationState)=>void}) {
  const queue=useQuery(api.assistant.queued,{projectId:conversation.projectId});
  const remove=useMutation(api.assistant.removeQueued),resume=useMutation(api.assistant.resumeQueue);
  const onRemoveQueued=useCallback((id:Id<'assistantQueue'>)=>remove({projectId:conversation.projectId,id}),[remove,conversation.projectId]);
  const onResumeQueue=useCallback(()=>resume({projectId:conversation.projectId}),[resume,conversation.projectId]);
  const {results,status,loadMore}=useUIMessages(api.assistant.messages,conversation,{initialNumItems:40,stream:true});
  const messages=useMemo(()=>results.map(chatMessageFromUI),[results]);
  const loadMoreRef=useRef(loadMore);loadMoreRef.current=loadMore;
  const historyExpansion=useRef(new AssistantHistoryExpansion());
  useEffect(()=>{if(historyExpansion.current.next(conversation.threadId,status,messages))loadMoreRef.current(20);},[conversation.threadId,status,messages]);
  const onLoadMore=useCallback(()=>loadMoreRef.current(20),[]);
  const state=useMemo(()=>({queued:queue?.messages??[],queuePaused:queue?.paused??false,onRemoveQueued,onResumeQueue,threadId:conversation.threadId,messages,canLoadMore:status==='CanLoadMore',onLoadMore}),[conversation.threadId,messages,status,onLoadMore,queue,onRemoveQueued,onResumeQueue]);
  useLayoutEffect(()=>onUpdate(state),[state,onUpdate]);
  return null;
});
/** Stream subscriptions live inside the conversation, away from preview/timeline. */
export function AssistantPanel(props:PanelProps) {
  const [conversationState,setConversationState]=useState<ConversationState>();
  const current=props.conversation&&conversationState?.threadId===props.conversation.threadId?conversationState:undefined;
  const visibleMessages=props.conversation?current?.messages??props.messages:props.messages;
  // Creating the first thread must not replace the chat body and lose its
  // optimistic message, composer DOM, or scroll position while history loads.
  return <>
    {props.conversation&&<ConnectedConversation conversation={props.conversation} onUpdate={setConversationState}/>}
    <AssistantTurnCostsProvider conversation={props.conversation} messages={visibleMessages} demo={props.demo}><AssistantPanelBody {...props} queued={current?.queued??props.queued} queuePaused={current?.queuePaused??props.queuePaused} onRemoveQueued={current?.onRemoveQueued??props.onRemoveQueued} onResumeQueue={current?.onResumeQueue??props.onResumeQueue} conversationStarted={!!props.conversation} messages={visibleMessages} canLoadMore={props.conversation?current?.canLoadMore:props.canLoadMore} onLoadMore={props.conversation?current?.onLoadMore:props.onLoadMore}/></AssistantTurnCostsProvider>
  </>;
}

type PendingReply = { id: string; text: string; previousUserId?: string; previousError?: string | null };

function AssistantReplyHeader({ loading, active=loading, label, detail, startedAt, promptMessageId }: { promptMessageId?:string; loading: boolean; active?:boolean; label: string; detail?: string; startedAt?:number|null }) {
  if (!active && !promptMessageId) return null;
  return <div className={`assistant-reply-header ${active ? 'is-processing' : 'chat-author'}`}>
    {active && <AssistantActivity label={loading?label:'Working'} detail={loading?detail:undefined} startedAt={startedAt}/>}
    {promptMessageId&&<AssistantTurnCostBadge promptMessageId={promptMessageId}/>}
  </div>;
}

function AssistantResponseText({ text, streaming }: { text: string; streaming: boolean }) {
  const [receivedLive, setReceivedLive] = useState(streaming);
  if (streaming && !receivedLive) setReceivedLive(true);
  // Keep the last received chunks fading after Convex marks the message complete.
  // A historical message mounts with this off, so opening a chat never replays it.
  return <ChatProse text={text} animate={receivedLive || streaming} />;
}

function AssistantPanelBody({ messages, running, editing:editingTimeline=running, configured, error, onSend, onRetry, onStop, hasClips, demo, onLoadMore, canLoadMore, onAttach, activity, activitySource, activityStartedAt, budgetUsed, draftKey, suggestions, onSuggestion, editSnapshot, canResumeEdit=false, defaultModelChoice, modelSwitcher = false, allowedModels = PRODUCTION_CLAUDE_MODEL_CHOICES, attachments, onRemoveAttachment, composerBusy = false, requireMedia = false, conversationStarted = false, queued=[],queuePaused=false,onRemoveQueued,onResumeQueue }: {
  messages: ChatMessage[]; running: boolean; editing?:boolean; configured: boolean; error?: string | null;
  modelSwitcher?: boolean;
  defaultModelChoice?:ClaudeModelChoice;
  allowedModels?: readonly ClaudeModelChoice[];
  onSend: (text: string, modelChoice?: ClaudeModelChoice, reasoningEffort?: OpenAIReasoningEffort, speedMode?: OpenAISpeedMode) => Promise<void>; hasClips: boolean; demo: boolean;
  onRetry?: (text: string, modelChoice?: ClaudeModelChoice, reasoningEffort?: OpenAIReasoningEffort, speedMode?: OpenAISpeedMode) => Promise<void>;
  onLoadMore?: () => void; canLoadMore?: boolean; onAttach?: () => void;
  attachments?: ComposerAttachment[]; onRemoveAttachment?: (id: string) => void; composerBusy?: boolean; requireMedia?: boolean;
  conversationStarted?: boolean;queued?:QueuedMessage[];queuePaused?:boolean;onRemoveQueued?:(id:Id<'assistantQueue'>)=>Promise<unknown>;onResumeQueue?:()=>Promise<unknown>;
  activity?: string | null; activitySource?: string | null; activityProgress?:number|null; activityStartedAt?:number|null; draftKey?:string;
  /** Share of this request's token cap used; the working block warns from 70%. */
  budgetUsed?: number;
  onStop?: () => Promise<void>;
  suggestions?: { sourceName:string;clipId:string;items:SourceEditSuggestion[] };
  onSuggestion?: (prompt:string,clipId:string,modelChoice?:ClaudeModelChoice,reasoningEffort?:OpenAIReasoningEffort,speedMode?:OpenAISpeedMode) => Promise<void>;
  canResumeEdit?:boolean;
  editSnapshot?:AssistantEditSnapshot;
}) {
  const [prompt, setPrompt] = useState('');
  const canChooseModel = process.env.NODE_ENV === 'development' && modelSwitcher;
  const sendInFlight=useRef(false);
  const currentDraftKey=useRef(draftKey);currentDraftKey.current=draftKey;
  const [modelChoice, setModelChoice] = useState<ClaudeModelChoice>();
  const [reasoningEffort,setReasoningEffort]=useState<OpenAIReasoningEffort>('medium');
  const [speedMode,setSpeedMode]=useState<OpenAISpeedMode>('standard');
  const supportedModels=allowedModels.filter(choice=>EDITOR_MODELS.some(model=>model.id===choice));
  const availableModels=supportedModels.length?supportedModels:PRODUCTION_CLAUDE_MODEL_CHOICES;
  const selectedModelChoice=modelChoice&&availableModels.some(choice=>choice===modelChoice)?modelChoice:undefined;
  const effectiveModelChoice=selectedModelChoice??(defaultModelChoice&&availableModels.some(choice=>choice===defaultModelChoice)?defaultModelChoice:availableModels.includes('gpt-6.1-sol')?'gpt-6.1-sol':availableModels[0]??'gpt-6.1-sol');
  const canChooseReasoning=canChooseModel&&OPENAI_EDIT_MODELS.some(model=>model.id===effectiveModelChoice);
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState('');
  const [stopState,setStopState]=useState<'stopping'|'stopped'|null>(null);
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  const answering = running || sending || !!pendingReply;
  const waiting = answering || !!activity;
  const latestUser = messages.findLast(message => message.role === 'user');
  const replyLabel = editingTimeline ? 'Editing…' : 'Replying…';
  const optimisticRequest = pendingReply && latestUser?.id === pendingReply.previousUserId ? pendingReply : null;
  // A long tool run can fill a page before its user message is loaded.
  // The visible assistant-only prefix is still the active turn, not a failed historical edit.
  const turnId = optimisticRequest?.id ?? latestUser?.id ?? messages[0]?.id ?? 'imported';
  const demoNoteMessageId = demo ? messages.findLast(message => message.role === 'assistant')?.id : undefined;
  const scroll = useConversationScroll(turnId, true, false);
  const legacyPublications=useRef(new Map<string,number>());
  const groups=useMemo(()=>{
    const turns:{id:string;messages:ChatMessage[]}[]=[];
    for(const message of messages){if(message.role==='user'||!turns.length)turns.push({id:message.id,messages:[]});turns.at(-1)!.messages.push(message);}
    if (optimisticRequest) turns.push({id:optimisticRequest.id,messages:[{id:optimisticRequest.id,role:'user',text:optimisticRequest.text}]});
    return turns.map(group=>{
      const replies=group.messages.filter(message=>message.role!=='user'),steps=group.messages.flatMap(message=>message.steps??[]);
      const comparison=group.id===turnId?savedEditComparison(steps,editSnapshot):null;
      if(comparison?.publishedRevision!==undefined)legacyPublications.current.set(group.id,comparison.publishedRevision);
      const publicationReceipt=turnPublicationReceipt(group.messages);
      const draftFailed=!running&&group.id===turnId&&(!!error||replies.some(message=>message.status==='failed'||message.status==='aborted'));
      const cards=summarizeTools(steps,{publicationReceipt,publishedRevision:legacyPublications.current.get(group.id),draftFailed,draftPending:group.id===turnId&&(answering||replies.some(message=>message.status==='pending'||message.status==='streaming'))});
      const presentation=assistantTurnPresentation(replies,cards,{receipt:publicationReceipt,active:group.id===turnId&&answering,error:group.id===turnId?(localError||(!waiting?error:null)):null});
      return {...group,comparison,...presentation};
    });
  },[messages,turnId,editSnapshot,running,error,localError,waiting,optimisticRequest,answering]);
  const retryTurnId=canResumeEdit?groups.findLast(group=>group.cards.some(card=>card.key==='turn-failure'))?.id:turnId;
  const showSuggestions=!conversationStarted&&!latestUser&&!waiting;
  const visibleError=!groups.length?(localError||(!waiting?error:null)):null;
  useEffect(() => { try { setPrompt(draftKey ? sessionStorage.getItem(draftKey) ?? '' : ''); } catch { setPrompt(''); } }, [draftKey]);
  useEffect(() => {
    if (!pendingReply) return;
    const newUser = latestUser && latestUser.id !== pendingReply.previousUserId;
    const replied = newUser && messages.slice(messages.indexOf(latestUser) + 1).some(message => message.role !== 'user' && (message.text || message.steps?.length || message.tools?.length || message.status === 'success' || message.status === 'failed' || message.status === 'aborted'));
    if ((newUser && (running || replied)) || (error && error !== pendingReply.previousError)) setPendingReply(null);
  }, [messages, running, error, pendingReply]);
  function changePrompt(value: string) { setPrompt(value); try { if (draftKey) sessionStorage.setItem(draftKey, value); } catch { /* Keep the live draft when storage is unavailable. */ } }

  async function stop() {
    setLocalError('');
    setStopState('stopping');
    try { await onStop?.(); setStopState('stopped'); }
    catch (e) { setStopState(null); setLocalError(userError(e, 'Could not stop this edit.')); }
  }

  async function sendRequest(draft: string, retry = false) {
    if (!draft.trim() || sendInFlight.current || sending || (!conversationStarted&&running) || pendingReply) return;
    const key=draftKey;sendInFlight.current=true;
    if (!retry) changePrompt('');
    setStopState(null); setSending(true); if(!running&&!queued.length)setPendingReply({ id: `pending-${crypto.randomUUID()}`, text: draft.trim(), previousUserId: latestUser?.id, previousError: error }); setLocalError(''); scroll.resume();
    try { await (retry && onRetry ? onRetry : onSend)(draft.trim(), canChooseModel ? selectedModelChoice : undefined, canChooseReasoning ? reasoningEffort : undefined, canChooseReasoning ? speedMode : undefined); }
    catch (e) { if(currentDraftKey.current===key){if(!retry)changePrompt(draft);setPendingReply(null);setLocalError(userError(e, 'Could not send message'));} }
    finally { sendInFlight.current=false;setSending(false); }
  }
  async function submit() { await sendRequest(prompt); }

  async function chooseSuggestion(suggestion: SourceEditSuggestion) {
    if (!suggestions || !onSuggestion || sendInFlight.current || sending || running || pendingReply || !configured) return;
    const request = `${suggestion.prompt}\n\nUse the selected clip from “${suggestions.sourceName}”, source ${suggestion.start.toFixed(2)}–${suggestion.end.toFixed(2)} seconds.`;
    sendInFlight.current=true;setStopState(null); setSending(true); setPendingReply({ id: `pending-${crypto.randomUUID()}`, text: request, previousUserId: latestUser?.id, previousError: error }); setLocalError(''); scroll.resume();
    try { await onSuggestion(request, suggestions.clipId, canChooseModel ? selectedModelChoice : undefined, canChooseReasoning ? reasoningEffort : undefined, canChooseReasoning ? speedMode : undefined); }
    catch (e) { setPendingReply(null); setLocalError(userError(e, 'Could not start this edit.')); }
    finally { sendInFlight.current=false;setSending(false); }
  }

  return <div className="assistant-content">
    <div ref={scroll.viewport} className={`assistant-history ${!messages.length && !waiting ? 'assistant-history-empty' : ''}`}>
      <div className="assistant-turns" ref={scroll.content}>
      {canLoadMore && <button className="load-more" onClick={() => { scroll.preserveHistory(); onLoadMore?.(); }}>Earlier messages</button>}
      {!messages.length && !waiting && !suggestions?.items.length && <div className="assistant-welcome"><h3>What are we making?</h3><p>{hasClips ? 'A tighter cut, a stronger opening, subtitles. Tell me what you have in mind.' : 'Bring your footage, and tell me the story you want to make.'}</p>{!demo&&!configured&&<div className="assistant-demo-note">AI editing is temporarily unavailable. Your footage, preview, and timeline are ready.</div>}</div>}
      {groups.map(group => {
        const groupMessages = group.messages;
        const replies = group.replies;
        const editing = group.id === turnId && waiting;
        const currentReply = replies.at(-1);
        const hasRunningTool = replies.some(message=>message.steps?.some(step=>step.state==='running'));
        const showingReply = !!currentReply?.text.trim() && !activity && !hasRunningTool && (currentReply.status === 'streaming' || answering);
        const loading = editing && (!showingReply || stopState === 'stopping');
        const cards = group.cards;
        const requestMessage=groupMessages.find(message=>message.role==='user');
        return <div className={`assistant-turn ${group.id === turnId ? 'is-latest-turn' : ''}`} data-turn-id={group.id} key={group.id}>
          {groupMessages.filter(message => message.role === 'user').map(message => <article key={message.id} data-message-id={message.id} data-message-status={message.status} className="chat-message chat-user"><p>{message.text}</p></article>)}
          {(replies.length > 0 || editing || cards.length > 0) && <div className="assistant-reply">
            {replies.map(message => <Fragment key={message.id}>{!message.text && !message.tools?.length && !message.blocks?.length && message.id !== demoNoteMessageId ? null : <article data-message-id={message.id} data-message-status={message.status} className="chat-message chat-assistant">
              {message.blocks ? message.blocks.map((block, index) => block.type === 'tools' ? <ToolChain key={`tools-${index}`} steps={block.steps} active={editing}/> : <AssistantResponseText key={`text-${index}`} text={block.text} streaming={message.status === 'streaming' && index === message.blocks!.length - 1} />) : message.text && <AssistantResponseText text={message.text} streaming={message.status === 'streaming'} />}
              {message.tools?.map((tool, i) => <div className="tool-result" key={`${tool}-${i}`}><Check size={12} />{tool}</div>)}
              {message.id === demoNoteMessageId && <div className="assistant-demo-note">Sample conversation. Explore the timeline, or <a href={NEW_PROJECT_PATH}>start your own project</a>.</div>}
            </article>}{!message.blocks && !!message.steps?.length && <ToolChain steps={message.steps} active={editing}/>}</Fragment>)}
            {cards.some(card=>card.state!=='done'||card.staged) && <div className="assistant-result-cards" aria-label="Edit results">{cards.filter(card=>(card.state!=='done'||card.staged)&&!(card.state==='running'&&(editing||(group.id===turnId&&stopState==='stopped')))).map(card => <div key={card.key} className={`assistant-result-card result-${card.state}${card.staged ? ' result-prepared' : ''}`}>
              <AssistantActivity label={card.title} detail={card.detail} state={card.state==='running'?'working':card.state==='error'?'error':'ready'}/>
              {card.key==='turn-failure' && group.id===retryTurnId && requestMessage?.text.trim() && !waiting && !demo && onRetry && <button type="button" className="assistant-retry" disabled={composerBusy || !configured || sending || !!pendingReply} onClick={() => void sendRequest(canResumeEdit?'Finish only the remaining work or checks from my unfinished request. Keep the edits already completed.':requestMessage.text, true)}><RotateCcw size={13} aria-hidden="true"/>Retry unfinished steps</button>}
            </div>)}</div>}
            <AssistantReplyHeader promptMessageId={requestMessage?.sourceId??requestMessage?.id} loading={loading} active={editing} label={stopState==='stopping'?'Stopping…':'Working'} detail={editing&&budgetUsed!==undefined&&budgetUsed>=.7?`Near this request's limit · ${Math.round(budgetUsed*100)}% used`:undefined} startedAt={activityStartedAt}/>
          </div>}
        </div>;
      })}
      {!groups.length && waiting && <div className="assistant-reply"><AssistantReplyHeader loading label={stopState==='stopping'?'Stopping…':'Working'} startedAt={activityStartedAt}/></div>}
      {!waiting && stopState==='stopped'  && <AssistantActivity label="Stopped." detail="Your existing edit is still here." state="stopped"/>}
      {showSuggestions && suggestions?.items.length && onSuggestion && configured ? <div data-chat-follow className="assistant-source-suggestions" aria-label="Suggested edits from this footage"><span title={suggestions.sourceName}>Ideas for {suggestions.sourceName}</span>{suggestions.items.map((suggestion, index) => <button key={`${suggestions.clipId}-${index}`} type="button" disabled={composerBusy || sending || !!pendingReply} onClick={() => void chooseSuggestion(suggestion)}><span>{suggestion.label}</span><ArrowUpRight size={14} aria-hidden="true" /></button>)}</div> : null}
      {visibleError && <div data-chat-follow><AssistantActivity className="chat-error" label="Needs attention" detail={assistantErrorDetail(visibleError)} state="error"/></div>}
      {!!messages.length && !demo && !configured && <div className="assistant-demo-note">AI editing is temporarily unavailable. Your footage, preview, and timeline are ready.</div>}
      </div>
    </div>
    <div ref={scroll.composer} className="manual-composer-dock">
    {scroll.latestHidden && <button className="chat-jump-latest" onClick={scroll.resume}>Latest response</button>}
    {queued.length>0&&<div className="assistant-queue" aria-label="Queued messages"><div className="assistant-queue-heading"><span>{queued.length} queued{queuePaused?' · paused':''}</span>{queuePaused&&onResumeQueue&&<button type="button" onClick={()=>void onResumeQueue().catch(e=>setLocalError(userError(e,'Could not resume the queue.')))}>Resume queue</button>}</div>{queued.map((message,index)=><div className="assistant-queued-message" key={message.id}><span className="assistant-queue-number">{index+1}</span><div><p>{message.prompt}</p>{message.error&&<small>{message.error}</small>}</div><button type="button" aria-label={`Remove queued message ${index+1}`} onClick={()=>void onRemoveQueued?.(message.id).catch(e=>setLocalError(userError(e,'Could not remove queued message.')))}><X size={13}/></button></div>)}</div>}
    <EditComposer allowQueue={conversationStarted&&!demo} attachments={attachments} onRemoveAttachment={onRemoveAttachment} requireMedia={requireMedia} actions={canChooseModel ? <div className="assistant-model-controls"><AssistantModelPicker allowedModels={availableModels} value={effectiveModelChoice} onChange={setModelChoice} disabled={answering}/>{canChooseReasoning&&<><div className="assistant-model-picker assistant-reasoning-picker"><InspectorSelect label="AI reasoning effort" value={reasoningEffort} options={OPENAI_REASONING_EFFORTS.map(value=>({value,label:{low:'Low',medium:'Medium',high:'High',xhigh:'X-high',max:'Max'}[value]}))} onChange={setReasoningEffort} disabled={answering}/></div><div className="assistant-model-picker assistant-speed-picker"><InspectorSelect label="AI speed mode" value={speedMode} options={OPENAI_SPEED_MODES.map(value=>({value,label:value==='fast'?'Fast':'Standard',description:value==='fast'?'2× token cost':'Standard speed and pricing'}))} onChange={setSpeedMode} disabled={answering}/></div></>}</div> : undefined} variant="compact" className="manual-editor-composer" value={prompt} onChange={changePrompt} onSubmit={submit} onAttach={onAttach} placeholder={running?"Add your next request to the queue…":"What would you change next?"} disabled={composerBusy || sending || !!pendingReply} running={running} onStop={onStop ? stop : undefined} stopping={stopState==='stopping'} />
    </div>
  </div>;
}
