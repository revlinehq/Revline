'use client';
import { userError } from '@/lib/user-error';

import { PRODUCTION_CLAUDE_MODEL_CHOICES } from '@/lib/ai/claude-model-policy';
import { memo, useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef, type ComponentProps } from 'react';
import { Check, ArrowUpRight } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { AssistantModelPicker } from './assistant-model-picker';
import {OPENAI_EDIT_MODELS,OPENAI_REASONING_EFFORTS,OPENAI_SPEED_MODES,type ClaudeModelChoice,type OpenAIReasoningEffort,type OpenAISpeedMode} from '@/lib/ai/claude-model';
import {InspectorSelect} from './inspector-select';
import { EditComposer, type ComposerAttachment } from '@/components/workspace/edit-composer';
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
type ConversationState = {threadId:string;messages:ChatMessage[];canLoadMore:boolean;onLoadMore:()=>void};
const ConnectedConversation = memo(function ConnectedConversation({conversation,onUpdate}:{conversation:Conversation;onUpdate:(state:ConversationState)=>void}) {
  const {results,status,loadMore}=useUIMessages(api.assistant.messages,conversation,{initialNumItems:40,stream:true});
  const messages=useMemo(()=>results.map(chatMessageFromUI),[results]);
  const loadMoreRef=useRef(loadMore);loadMoreRef.current=loadMore;
  const historyExpansion=useRef(new AssistantHistoryExpansion());
  useEffect(()=>{if(historyExpansion.current.next(conversation.threadId,status,messages))loadMoreRef.current(20);},[conversation.threadId,status,messages]);
  const onLoadMore=useCallback(()=>loadMoreRef.current(20),[]);
  const state=useMemo(()=>({threadId:conversation.threadId,messages,canLoadMore:status==='CanLoadMore',onLoadMore}),[conversation.threadId,messages,status,onLoadMore]);
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
    <AssistantTurnCostsProvider conversation={props.conversation} messages={visibleMessages} demo={props.demo}><AssistantPanelBody {...props} conversationStarted={!!props.conversation} messages={visibleMessages} canLoadMore={props.conversation?current?.canLoadMore:props.canLoadMore} onLoadMore={props.conversation?current?.onLoadMore:props.onLoadMore}/></AssistantTurnCostsProvider>
  </>;
}

type PendingReply = { id: string; text: string; previousUserId?: string; previousError?: string | null };

function AssistantReplyHeader({ loading, active=loading, label, detail, startedAt, promptMessageId }: { promptMessageId?:string; loading: boolean; active?:boolean; label: string; detail?: string; startedAt?:number|null }) {
  return <div className={`assistant-reply-header ${active ? 'is-processing' : 'chat-author'}`}>
    <Brand markOnly/>
    {active ? <AssistantActivity label={loading?label:'Revline'} detail={loading?detail:undefined} startedAt={startedAt}/> : <span>Revline</span>}
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

function AssistantPanelBody({ messages, running, editing:editingTimeline=running, configured, error, onSend, onStop, hasClips, demo, onLoadMore, canLoadMore, onAttach, activity, activitySource, activityStartedAt, draftKey, suggestions, onSuggestion, editSnapshot, defaultModelChoice, modelSwitcher = false, allowedModels = PRODUCTION_CLAUDE_MODEL_CHOICES, attachments, onRemoveAttachment, composerBusy = false, requireMedia = false, conversationStarted = false }: {
  messages: ChatMessage[]; running: boolean; editing?:boolean; configured: boolean; error?: string | null;
  modelSwitcher?: boolean;
  defaultModelChoice?:ClaudeModelChoice;
  allowedModels?: readonly ClaudeModelChoice[];
  onSend: (text: string, modelChoice?: ClaudeModelChoice, reasoningEffort?: OpenAIReasoningEffort, speedMode?: OpenAISpeedMode) => Promise<void>; hasClips: boolean; demo: boolean;
  onLoadMore?: () => void; canLoadMore?: boolean; onAttach?: () => void;
  attachments?: ComposerAttachment[]; onRemoveAttachment?: (id: string) => void; composerBusy?: boolean; requireMedia?: boolean;
  conversationStarted?: boolean;
  activity?: string | null; activitySource?: string | null; activityProgress?:number|null; activityStartedAt?:number|null; draftKey?:string;
  onStop?: () => Promise<void>;
  suggestions?: { sourceName:string;clipId:string;items:SourceEditSuggestion[] };
  onSuggestion?: (prompt:string,clipId:string,modelChoice?:ClaudeModelChoice,reasoningEffort?:OpenAIReasoningEffort,speedMode?:OpenAISpeedMode) => Promise<void>;
  editSnapshot?:AssistantEditSnapshot;
}) {
  const [prompt, setPrompt] = useState('');
  const canChooseModel = process.env.NODE_ENV === 'development' && modelSwitcher;
  const sendInFlight=useRef(false);
  const currentDraftKey=useRef(draftKey);currentDraftKey.current=draftKey;
  const [modelChoice, setModelChoice] = useState<ClaudeModelChoice>();
  const [reasoningEffort,setReasoningEffort]=useState<OpenAIReasoningEffort>('medium');
  const [speedMode,setSpeedMode]=useState<OpenAISpeedMode>('standard');
  const supportedModels=allowedModels.filter(choice=>OPENAI_EDIT_MODELS.some(model=>model.id===choice));
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

  async function submit() {
    if (!prompt.trim() || sendInFlight.current || sending || running || pendingReply) return;
    const draft=prompt,key=draftKey;sendInFlight.current=true;
    changePrompt('');
    setStopState(null); setSending(true); setPendingReply({ id: `pending-${crypto.randomUUID()}`, text: draft.trim(), previousUserId: latestUser?.id, previousError: error }); setLocalError(''); scroll.resume();
    try { await onSend(draft.trim(), canChooseModel ? selectedModelChoice : undefined, canChooseReasoning ? reasoningEffort : undefined, canChooseReasoning ? speedMode : undefined); }
    catch (e) { if(currentDraftKey.current===key){changePrompt(draft);setPendingReply(null);setLocalError(userError(e, 'Could not send message'));} }
    finally { sendInFlight.current=false;setSending(false); }
  }

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
      {!messages.length && !waiting && !suggestions?.items.length && <div className="assistant-welcome"><h3>What are we making?</h3><p>{hasClips ? 'A tighter cut, a stronger opening, subtitles. Tell me what you have in mind.' : 'Bring your footage, and tell me the story you want to make.'}</p>{!demo&&!configured&&<div className="assistant-demo-note">Connect OpenAI to edit in conversation. Your footage, preview, and timeline are ready.</div>}</div>}
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
            <AssistantReplyHeader promptMessageId={requestMessage?.sourceId??requestMessage?.id} loading={loading} active={editing} label={stopState==='stopping'?'Stopping…':activity || replyLabel} detail={processingDetail(activity,activitySource)||cards.find(card=>card.state==='running')?.title} startedAt={activityStartedAt}/>
            {replies.map(message => !message.text && !message.tools?.length && message.id !== demoNoteMessageId ? null : <article key={message.id} data-message-id={message.id} data-message-status={message.status} className="chat-message chat-assistant">
              {message.text && <AssistantResponseText text={message.text} streaming={message.status === 'streaming'} />}
              {message.tools?.map((tool, i) => <div className="tool-result" key={`${tool}-${i}`}><Check size={12} />{tool}</div>)}
              {message.id === demoNoteMessageId && <div className="assistant-demo-note">Sample conversation. Explore the timeline, or <a href="/projects">start your own project</a>.</div>}
            </article>)}
            {cards.length > 0 && <div className="assistant-result-cards" aria-label="Edit results">{cards.filter(card=>!(card.state==='running'&&(editing||(group.id===turnId&&stopState==='stopped')))).map(card => <div key={card.key} className={`assistant-result-card result-${card.state}${card.staged ? ' result-prepared' : ''}`}>
              <AssistantActivity label={card.title} detail={card.detail} state={card.state==='running'?'working':card.state==='error'?'error':'ready'}/>
            </div>)}</div>}
          </div>}
        </div>;
      })}
      {!groups.length && waiting && <div className="assistant-reply"><AssistantReplyHeader loading label={stopState==='stopping'?'Stopping…':activity || replyLabel} detail={processingDetail(activity,activitySource)} startedAt={activityStartedAt}/></div>}
      {!waiting && stopState==='stopped' && <AssistantActivity label="Stopped." detail="Your existing edit is still here." state="stopped"/>}
      {showSuggestions && suggestions?.items.length && onSuggestion && configured ? <div data-chat-follow className="assistant-source-suggestions" aria-label="Suggested edits from this footage"><span title={suggestions.sourceName}>Ideas for {suggestions.sourceName}</span>{suggestions.items.map((suggestion, index) => <button key={`${suggestions.clipId}-${index}`} type="button" disabled={composerBusy || sending || !!pendingReply} onClick={() => void chooseSuggestion(suggestion)}><span>{suggestion.label}</span><ArrowUpRight size={14} aria-hidden="true" /></button>)}</div> : null}
      {visibleError && <div data-chat-follow><AssistantActivity className="chat-error" label="Needs attention" detail={assistantErrorDetail(visibleError)} state="error"/></div>}
      {!!messages.length && !demo && !configured && <div className="assistant-demo-note">Connect OpenAI to edit in conversation. Your footage, preview, and timeline are ready.</div>}
      </div>
    </div>
    <div ref={scroll.composer} className="manual-composer-dock">
    {scroll.latestHidden && <button className="chat-jump-latest" onClick={scroll.resume}>Latest response</button>}
    <EditComposer attachments={attachments} onRemoveAttachment={onRemoveAttachment} requireMedia={requireMedia} actions={canChooseModel ? <div className="assistant-model-controls"><AssistantModelPicker allowedModels={availableModels} value={effectiveModelChoice} onChange={setModelChoice} disabled={answering}/>{canChooseReasoning&&<><div className="assistant-model-picker assistant-reasoning-picker"><InspectorSelect label="AI reasoning effort" value={reasoningEffort} options={OPENAI_REASONING_EFFORTS.map(value=>({value,label:{low:'Low',medium:'Medium',high:'High',xhigh:'X-high',max:'Max'}[value]}))} onChange={setReasoningEffort} disabled={answering}/></div><div className="assistant-model-picker assistant-speed-picker"><InspectorSelect label="AI speed mode" value={speedMode} options={OPENAI_SPEED_MODES.map(value=>({value,label:value==='fast'?'Fast':'Standard',description:value==='fast'?'2× token cost':'Standard speed and pricing'}))} onChange={setSpeedMode} disabled={answering}/></div></>}</div> : undefined} variant="compact" className="manual-editor-composer" value={prompt} onChange={changePrompt} onSubmit={submit} onAttach={onAttach} placeholder="What would you change next?" disabled={composerBusy || sending || !!pendingReply} running={running} onStop={onStop ? stop : undefined} />
    </div>
  </div>;
}
