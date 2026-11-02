'use client';
import { ThinkingBlock, ToolChain } from './tool-chain';
import { ChoiceCard, choiceOf } from './choice-card';
import { ReferenceCard, referenceOf, type ReferenceMedia } from './reference-card';
import { userError } from '@/lib/user-error';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

import { PRODUCTION_CLAUDE_MODEL_CHOICES } from '@/lib/ai/claude-model-policy';
import { Fragment, memo, useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef, type ComponentProps } from 'react';
import { Check, ArrowUpRight, Lightbulb, RotateCcw, X } from 'lucide-react';
import type { EditorEditMode } from '@/lib/ai/edit-mode';
import { AssistantModelPicker } from './assistant-model-picker';
import { AssistantModePicker, useAssistantEditMode } from './assistant-mode-picker';
import { EDITOR_MODELS, type ClaudeModelChoice, type EditorReasoningEffort, type EditorSpeedMode } from '@/lib/ai/claude-model';
import { EditComposer, type ComposerAttachment } from '@/components/workspace/edit-composer';
import { McpLogo } from '@/components/workspace/ai-app-logos';
import { AgentLogo } from '@/components/workspace/agent-logo';
import { useQuery, useMutation } from 'convex/react';
import { useUIMessages } from '@convex-dev/agent/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { chatMessageFromUI } from './assistant-results';
import { assistantTurnPresentation, assistantErrorDetail } from './assistant-turn-presentation';
import { ChatProse } from './chat-prose';
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from '@/components/ui/message-scroller';
import { Message, MessageContent } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { liveActivity, savedEditComparison, summarizeTools, turnPublicationReceipt, type AssistantEditSnapshot, type ChatMessage } from './assistant-results';
import './assistant-results.css';
import './assistant-editing.css';
import './assistant-panel.css';
import type { SourceEditSuggestion } from '@/lib/editor/types';
import { AssistantActivity } from './assistant-activity';
import { AssistantHistoryExpansion } from './assistant-history-pagination';
export type { ChatTool, ChatMessage } from './assistant-results';

type Conversation = {projectId:Id<'projects'>;threadId:string};
type PanelProps = ComponentProps<typeof AssistantPanelBody> & {conversation?:Conversation};
type QueuedMessage={id:Id<'assistantQueue'>;prompt:string;error?:string};
type ConversationState = {queued:QueuedMessage[];queuePaused:boolean;onRemoveQueued:(id:Id<'assistantQueue'>)=>Promise<unknown>;onResumeQueue:()=>Promise<unknown>;threadId:string;messages:ChatMessage[];canLoadMore:boolean;onLoadMore:()=>void};
const LIVE_PAGE_MESSAGES=12,OPENING_MESSAGES=40;
const ConnectedConversation = memo(function ConnectedConversation({conversation,onUpdate}:{conversation:Conversation;onUpdate:(state:ConversationState)=>void}) {
  const queue=useQuery(api.assistant.queued,{projectId:conversation.projectId});
  const remove=useMutation(api.assistant.removeQueued),resume=useMutation(api.assistant.resumeQueue);
  const onRemoveQueued=useCallback((id:Id<'assistantQueue'>)=>remove({projectId:conversation.projectId,id}),[remove,conversation.projectId]);
  const onResumeQueue=useCallback(()=>resume({projectId:conversation.projectId}),[resume,conversation.projectId]);
  // Only the newest page re-runs (and re-reads every message in it) as a turn adds steps, and the
  // pagination splits it whenever it outgrows initialNumItems. Keep it small and fill the opening view
  // with one older page, so the chat still opens with the latest 40 messages.
  const {results,status,loadMore}=useUIMessages(api.assistant.messages,conversation,{initialNumItems:LIVE_PAGE_MESSAGES,stream:true});
  // The latest-page query slides forward as messages arrive; keep what was already shown
  // so the list only grows at the bottom and the chat scroller never sees rows vanish above.
  const shown=useRef<{threadId:string;messages:ChatMessage[]}>({threadId:conversation.threadId,messages:[]});
  const messages=useMemo(()=>{
    const latest=results.map(chatMessageFromUI);
    const kept=shown.current.threadId===conversation.threadId?shown.current.messages:[];
    // Rows shown before the page's first message stay above it; a page reaching further back replaces them.
    const cut=latest.length?kept.findIndex(message=>message.id===latest[0].id):-1;
    const next=[...(cut>0?kept.slice(0,cut):[]),...latest];
    shown.current={threadId:conversation.threadId,messages:next};
    return next;
  },[results,conversation.threadId]);
  const loadMoreRef=useRef(loadMore);loadMoreRef.current=loadMore;
  const historyExpansion=useRef(new AssistantHistoryExpansion());
  const filled=useRef<string|null>(null);
  useEffect(()=>{if(status==='CanLoadMore'&&filled.current!==conversation.threadId){filled.current=conversation.threadId;loadMoreRef.current(OPENING_MESSAGES-LIVE_PAGE_MESSAGES);}},[conversation.threadId,status]);
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
    <MessageScrollerProvider autoScroll><AssistantPanelBody {...props} queued={current?.queued??props.queued} queuePaused={current?.queuePaused??props.queuePaused} onRemoveQueued={current?.onRemoveQueued??props.onRemoveQueued} onResumeQueue={current?.onResumeQueue??props.onResumeQueue} conversationStarted={!!props.conversation} messages={visibleMessages} canLoadMore={props.conversation?current?.canLoadMore:props.canLoadMore} onLoadMore={props.conversation?current?.onLoadMore:props.onLoadMore}/></MessageScrollerProvider>
  </>;
}

type PendingReply = { id: string; text: string; previousUserId?: string; previousError?: string | null };

function AssistantReplyHeader({ loading, active=loading, label, detail, startedAt }: { loading: boolean; active?:boolean; label: string; detail?: string; startedAt?:number|null }) {
  if (!active) return null;
  return <div className="assistant-reply-header is-processing">
    <AssistantActivity label={loading?label:'Working'} detail={loading?detail:undefined} startedAt={startedAt}/>
  </div>;
}

function AssistantResponseText({ text, streaming }: { text: string; streaming: boolean }) {
  const [receivedLive, setReceivedLive] = useState(streaming);
  if (streaming && !receivedLive) setReceivedLive(true);
  // Keep the last received chunks fading after Convex marks the message complete.
  // A historical message mounts with this off, so opening a chat never replays it.
  return <ChatProse text={text} animate={receivedLive || streaming} />;
}

function AssistantPanelBody({ messages, running, editing:editingTimeline=running, configured, error, onSend, onRetry, onStop, hasClips, demo, onLoadMore, canLoadMore, onAttach, activity, activitySource, activityStartedAt, budgetUsed, draftKey, suggestions, onSuggestion, editSnapshot, canResumeEdit=false, defaultModelChoice, modelSwitcher = false, effortSwitcher = false, liveEffort, claudeViaMcp, allowedModels = PRODUCTION_CLAUDE_MODEL_CHOICES, attachments, onRemoveAttachment, composerBusy = false, requireMedia = false, conversationStarted = false, queued=[],queuePaused=false,onRemoveQueued,onResumeQueue,externalAgent,referenceMedia }: {
  externalAgent?: string | null;
  messages: ChatMessage[]; running: boolean; editing?:boolean; configured: boolean; error?: string | null;
  modelSwitcher?: boolean;
  /** Development only: choose an effort, or see the one the editor picked. */
  effortSwitcher?: boolean; liveEffort?: EditorReasoningEffort;
  defaultModelChoice?:ClaudeModelChoice;
  allowedModels?: readonly ClaudeModelChoice[];
  claudeViaMcp?: boolean;
  onSend: (text: string, modelChoice?: ClaudeModelChoice, reasoningEffort?: EditorReasoningEffort, speedMode?: EditorSpeedMode, editMode?: EditorEditMode) => Promise<void>; hasClips: boolean; demo: boolean;
  onRetry?: (text: string, modelChoice?: ClaudeModelChoice, reasoningEffort?: EditorReasoningEffort, speedMode?: EditorSpeedMode, editMode?: EditorEditMode) => Promise<void>;
  onLoadMore?: () => void; canLoadMore?: boolean; onAttach?: () => void;
  attachments?: ComposerAttachment[]; onRemoveAttachment?: (id: string) => void; composerBusy?: boolean; requireMedia?: boolean;
  /** Playback URLs for reference breakdown cards, by asset id. */
  referenceMedia?: (assetId: string) => ReferenceMedia | undefined;
  conversationStarted?: boolean;queued?:QueuedMessage[];queuePaused?:boolean;onRemoveQueued?:(id:Id<'assistantQueue'>)=>Promise<unknown>;onResumeQueue?:()=>Promise<unknown>;
  activity?: string | null; activitySource?: string | null; activityProgress?:number|null; activityStartedAt?:number|null; draftKey?:string;
  /** Share of this request's token cap used; the working block warns from 70%. */
  budgetUsed?: number;
  onStop?: () => Promise<void>;
  suggestions?: { sourceName:string;clipId:string;items:SourceEditSuggestion[] };
  onSuggestion?: (prompt:string,clipId:string,modelChoice?:ClaudeModelChoice,reasoningEffort?:EditorReasoningEffort,speedMode?:EditorSpeedMode,editMode?:EditorEditMode) => Promise<void>;
  canResumeEdit?:boolean;
  editSnapshot?:AssistantEditSnapshot;
}) {
  const [prompt, setPrompt] = useState('');
  // The server offers the switcher to Ultra accounts and to open (development) deployments.
  const canChooseModel = !!modelSwitcher;
  const sendInFlight=useRef(false);
  const currentDraftKey=useRef(draftKey);currentDraftKey.current=draftKey;
  const [modelChoice, setModelChoice] = useState<ClaudeModelChoice>();
  const editMode = useAssistantEditMode();
  // Undefined is Auto: the editor picks the effort per request.
  const [effortChoice, setEffortChoice] = useState<EditorReasoningEffort>();
  const chosenEffort = effortSwitcher ? effortChoice : undefined;
  const supportedModels=allowedModels.filter(choice=>EDITOR_MODELS.some(model=>model.id===choice));
  const availableModels=supportedModels.length?supportedModels:PRODUCTION_CLAUDE_MODEL_CHOICES;
  const selectedModelChoice=modelChoice&&availableModels.some(choice=>choice===modelChoice)?modelChoice:undefined;
  const effectiveModelChoice=selectedModelChoice??(defaultModelChoice&&availableModels.some(choice=>choice===defaultModelChoice)?defaultModelChoice:availableModels.includes('gpt-6.1-sol')?'gpt-6.1-sol':availableModels[0]??'gpt-6.1-sol');
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState('');
  const [stopState,setStopState]=useState<'stopping'|'stopped'|null>(null);
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  // An MCP agent's work is not a reply in this chat; it shows as one centered notice instead.
  const answering = (running && !externalAgent) || sending || !!pendingReply;
  const waiting = answering || (!externalAgent && !!activity);
  const latestUser = messages.findLast(message => message.role === 'user');
  const replyLabel = editingTimeline ? 'Editing…' : 'Replying…';
  const optimisticRequest = pendingReply && latestUser?.id === pendingReply.previousUserId ? pendingReply : null;
  // A long tool run can fill a page before its user message is loaded.
  // The visible assistant-only prefix is still the active turn, not a failed historical edit.
  const turnId = optimisticRequest?.id ?? latestUser?.id ?? messages[0]?.id ?? 'imported';
  const demoNoteMessageId = demo ? messages.findLast(message => message.role === 'assistant')?.id : undefined;
  // The sent message shows at once under a placeholder id; when the saved message replaces it,
  // that turn keeps the placeholder's id so the chat scroller sees one continuous item.
  const turnKeys = useRef(new Map<string, string>());
  if (pendingReply && latestUser && latestUser.id !== pendingReply.previousUserId) turnKeys.current.set(latestUser.id, pendingReply.id);
  const turnKey = (id: string) => turnKeys.current.get(id) ?? id;
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
  const showSuggestions=!conversationStarted&&!latestUser&&!waiting&&!externalAgent;
  const visibleError=!groups.length?(localError||(!waiting?error:null)):null;
  useEffect(() => { try { setPrompt(draftKey ? sessionStorage.getItem(draftKey) ?? '' : ''); } catch { setPrompt(''); } }, [draftKey]);
  // The model picked for a project stays picked across reloads, so a long test never quietly switches models.
  useEffect(() => { try { const saved = draftKey ? localStorage.getItem(`${draftKey}:model`) : null; setModelChoice(saved ? saved as ClaudeModelChoice : undefined); } catch { /* The default model applies. */ } }, [draftKey]);
  function chooseModel(value: ClaudeModelChoice) { setModelChoice(value); try { if (draftKey) localStorage.setItem(`${draftKey}:model`, value); } catch { /* The choice holds for this visit. */ } }
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
    setStopState(null); setSending(true); if(!running&&!queued.length)setPendingReply({ id: `pending-${crypto.randomUUID()}`, text: draft.trim(), previousUserId: latestUser?.id, previousError: error }); setLocalError('');
    try { await (retry && onRetry ? onRetry : onSend)(draft.trim(), canChooseModel ? selectedModelChoice : undefined, chosenEffort, undefined, editMode.value); }
    catch (e) { if(currentDraftKey.current===key){if(!retry)changePrompt(draft);setPendingReply(null);setLocalError(userError(e, 'Could not send message'));} }
    finally { sendInFlight.current=false;setSending(false); }
  }
  async function submit() { await sendRequest(prompt); }

  async function chooseSuggestion(suggestion: SourceEditSuggestion) {
    if (!suggestions || !onSuggestion || sendInFlight.current || sending || running || pendingReply || !configured) return;
    const request = `${suggestion.prompt}\n\nUse the selected clip from “${suggestions.sourceName}”, source ${suggestion.start.toFixed(2)}–${suggestion.end.toFixed(2)} seconds.`;
    sendInFlight.current=true;setStopState(null); setSending(true); setPendingReply({ id: `pending-${crypto.randomUUID()}`, text: request, previousUserId: latestUser?.id, previousError: error }); setLocalError('');
    try { await onSuggestion(request, suggestions.clipId, canChooseModel ? selectedModelChoice : undefined, chosenEffort, undefined, editMode.value); }
    catch (e) { setPendingReply(null); setLocalError(userError(e, 'Could not start this edit.')); }
    finally { sendInFlight.current=false;setSending(false); }
  }

  return <div className="assistant-content">
    <MessageScroller><MessageScrollerViewport>
      <MessageScrollerContent className="gap-6 pt-0 pb-6">
      {canLoadMore && <Button variant="ghost" size="sm" className="load-more" onClick={() => onLoadMore?.()}>Earlier messages</Button>}
      {!messages.length && !waiting && !externalAgent && !suggestions?.items.length && <Empty className="assistant-welcome h-full"><EmptyHeader><EmptyTitle>What are we making?</EmptyTitle><EmptyDescription>{hasClips ? 'A tighter cut, a stronger opening, subtitles. Tell me what you have in mind.' : 'Bring your footage, and tell me the story you want to make.'}</EmptyDescription></EmptyHeader>{!demo&&!configured&&<EmptyContent><p className="assistant-demo-note">AI editing is temporarily unavailable. Your footage, preview, and timeline are ready.</p></EmptyContent>}</Empty>}
      {groups.map(group => {
        const groupMessages = group.messages;
        const replies = group.replies;
        const editing = group.id === turnId && waiting;
        const currentReply = replies.at(-1);
        // Steps left without results by Stop or a finished run are not still working.
        const hasRunningTool = editing && replies.some(message=>message.steps?.some(step=>step.state==='running'));
        const showingReply = !!currentReply?.text.trim() && !activity && !hasRunningTool && (currentReply.status === 'streaming' || answering);
        const loading = editing && (!showingReply || stopState === 'stopping');
        const cards = group.cards;
        const requestMessage=groupMessages.find(message=>message.role==='user');
        // As in shadcn Chat: each person's message is its own anchored item; the reply is the item after it.
        return <Fragment key={turnKey(group.id)}>
          {groupMessages.filter(message => message.role === 'user').map(message => <MessageScrollerItem key={turnKey(message.id)} messageId={turnKey(message.id)} scrollAnchor data-message-id={message.id} data-message-status={message.status}>
            <Message align="end"><MessageContent><Bubble align="end" variant="muted"><BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent></Bubble></MessageContent></Message>
          </MessageScrollerItem>)}
          {(replies.length > 0 || editing || cards.length > 0) && <MessageScrollerItem messageId={`${turnKey(group.id)}-reply`} data-turn-id={group.id}>
            <Message><MessageContent className="gap-3">
              {replies.map(message => <Fragment key={message.id}>
                {message.blocks ? message.blocks.map((block, index) => block.type === 'tools' ? <ToolChain key={`tools-${index}`} steps={block.steps} active={editing}/> : block.type === 'thinking' ? <ThinkingBlock key={`thinking-${index}`} text={block.text} active={editing && message.status === 'streaming' && index === message.blocks!.length - 1}/> : <AssistantResponseText key={`text-${index}`} text={block.text} streaming={message.status === 'streaming' && index === message.blocks!.length - 1} />) : <>{message.text && <AssistantResponseText text={message.text} streaming={message.status === 'streaming'} />}{!!message.steps?.length && <ToolChain steps={message.steps} active={editing}/>}</>}
                {message.tools?.map((tool, i) => <div className="tool-result" key={`${tool}-${i}`}><Check size={12} />{tool}</div>)}
                {(message.steps ?? []).flatMap(step => { const reference = referenceOf(step); return reference ? [<ReferenceCard key={`reference-${step.id ?? reference.assetId}`} view={reference} media={referenceMedia?.(reference.assetId)} onPick={demo ? undefined : token => changePrompt(prompt.trim() ? `${prompt.trimEnd()} ${token}` : token)}/>] : []; })}
                {(message.steps ?? []).flatMap(step => { const ask = choiceOf(step); return ask ? [<ChoiceCard key={step.id ?? step.name} question={ask.question} choices={ask.choices} disabled={running || sending || !!pendingReply} onChoose={group === groups.at(-1) && !running ? reply => void sendRequest(reply) : undefined}/>] : []; })}
                {message.id === demoNoteMessageId && <div className="assistant-demo-note">Sample conversation. Explore the timeline, or <a href={NEW_PROJECT_PATH}>start your own project</a>.</div>}
              </Fragment>)}
              {cards.some(card=>card.state!=='done'&&card.state!=='running') && <div className="assistant-result-cards" aria-label="Edit results">{cards.filter(card=>card.state!=='done'&&card.state!=='running').map(card => <div key={card.key} className={`assistant-result-card result-${card.state}${card.staged ? ' result-prepared' : ''}`}>
                <AssistantActivity label={card.title} detail={card.detail} state={card.state==='running'?'working':card.state==='error'?'error':'ready'}/>
                {card.key==='turn-failure' && group.id===retryTurnId && requestMessage?.text.trim() && !waiting && !demo && onRetry && <Button type="button" variant="outline" size="sm" disabled={composerBusy || !configured || sending || !!pendingReply} onClick={() => void sendRequest('Finish only the remaining work or checks from my unfinished request. Keep the edits already completed.', true)}><RotateCcw aria-hidden="true"/>Retry unfinished steps</Button>}
              </div>)}</div>}
              {(()=>{const now=liveActivity(replies);return <AssistantReplyHeader loading active={editing} label={stopState==='stopping'?'Stopping…':now.label} detail={editing&&budgetUsed!==undefined&&budgetUsed>=.7?`Near this request's limit · ${Math.round(budgetUsed*100)}% used`:now.detail} startedAt={activityStartedAt}/>;})()}
            </MessageContent></Message>
          </MessageScrollerItem>}
        </Fragment>;
      })}
      {!groups.length && waiting && <div className="assistant-reply"><AssistantReplyHeader loading label={stopState==='stopping'?'Stopping…':'Working'} startedAt={activityStartedAt}/></div>}
      {externalAgent && <div data-chat-follow data-alone={!groups.length||undefined} className="assistant-agent-notice" role="status"><span>Connected through <McpLogo className="assistant-agent-logo"/> MCP</span><strong><AgentLogo name={externalAgent} className="assistant-agent-logo"/>{externalAgent} is working</strong></div>}
      {!waiting && stopState==='stopped'  && <AssistantActivity label="Stopped." detail="Your existing edit is still here." state="stopped"/>}
      {showSuggestions && suggestions?.items.length && onSuggestion && configured ? <div data-chat-follow className="assistant-source-suggestions" aria-label="Suggested edits from this footage"><span title={suggestions.sourceName}><Lightbulb size={12} aria-hidden="true" />Ideas for {suggestions.sourceName}</span>{suggestions.items.map((suggestion, index) => <button key={`${suggestions.clipId}-${index}`} type="button" disabled={composerBusy || sending || !!pendingReply} onClick={() => void chooseSuggestion(suggestion)}><span>{suggestion.label}</span><ArrowUpRight size={14} aria-hidden="true" /></button>)}</div> : null}
      {visibleError && <div data-chat-follow><AssistantActivity className="chat-error" label="Needs attention" detail={assistantErrorDetail(visibleError)} state="error"/></div>}
      {!!messages.length && !demo && !configured && <div className="assistant-demo-note">AI editing is temporarily unavailable. Your footage, preview, and timeline are ready.</div>}
      </MessageScrollerContent>
    </MessageScrollerViewport><MessageScrollerButton /></MessageScroller>
    <div className="manual-composer-dock">
    {queued.length>0&&<div className="assistant-queue" aria-label="Queued messages"><div className="assistant-queue-heading"><span>{queued.length} queued{queuePaused?' · paused':''}</span>{queuePaused&&onResumeQueue&&<button type="button" onClick={()=>void onResumeQueue().catch(e=>setLocalError(userError(e,'Could not resume the queue.')))}>Resume queue</button>}</div>{queued.map((message,index)=><div className="assistant-queued-message" key={message.id}><span className="assistant-queue-number">{index+1}</span><div><p>{message.prompt}</p>{message.error&&<small>{message.error}</small>}</div><button type="button" aria-label={`Remove queued message ${index+1}`} onClick={()=>void onRemoveQueued?.(message.id).catch(e=>setLocalError(userError(e,'Could not remove queued message.')))}><X size={13}/></button></div>)}</div>}
    <EditComposer allowQueue={conversationStarted&&!demo} attachments={attachments} onRemoveAttachment={onRemoveAttachment} requireMedia={requireMedia} actions={<div className="assistant-model-controls">{(canChooseModel || claudeViaMcp) && <AssistantModelPicker claudeViaMcp={claudeViaMcp} allowedModels={canChooseModel ? availableModels : [effectiveModelChoice]} value={effectiveModelChoice} onChange={chooseModel} disabled={answering} effort={canChooseModel && effortSwitcher ? { value: effortChoice, live: liveEffort, onChange: setEffortChoice } : undefined}/>}<AssistantModePicker {...editMode} disabled={answering}/></div>} variant="compact" className="manual-editor-composer" value={prompt} onChange={changePrompt} onSubmit={submit} onAttach={onAttach} placeholder={externalAgent ? `${externalAgent} is editing over MCP. What you send runs when it finishes.` : "What would you change next?"} disabled={composerBusy || sending || !!pendingReply} running={running && !externalAgent} onStop={onStop ? stop : undefined} stopping={stopState==='stopping'} />
    </div>
  </div>;
}
