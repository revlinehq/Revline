'use client';
import { AiUsageBanner } from '@/components/workspace/plan-usage';
import { RunSteps, RunThought } from './run-activity';
import { turnActivity } from './assistant-run';
import { ChoiceCard, choiceOf } from './choice-card';
import { PostConfirmCard, postProposalOf } from './post-confirm-card';
import { ExportConfirmCard, exportProposalOf } from './export-confirm-card';
import { reportClientIncident } from '@/lib/incident-client';
import { userError } from '@/lib/user-error';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

import { Fragment, memo, useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef, type ComponentProps, type ReactNode } from 'react';
import { ArrowUpRight, Lightbulb, RotateCcw, X } from 'lucide-react';
import { useAssistantComposerControls, type ComposerSettings } from './assistant-composer-controls';
import { EDITOR_EFFORT_LABELS, editorModelLabel } from './assistant-model-picker';
import type { ClaudeModelChoice, EditorReasoningEffort, EditorSpeedMode } from '@/lib/ai/claude-model';
import { EditComposer } from '@/components/workspace/edit-composer';
import type { ComposerAttachment } from '@/lib/editor/composer-media';
import { storeDraftText, storedDraftText } from '@/lib/editor/opening-request';
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
import { liveActivity, savedEditComparison, summarizeTools, turnPublicationReceipt, type AssistantEditSnapshot } from './assistant-results';
import type { ChatMessage } from './chat-types';
import type { RunFailureCode } from '@/lib/ai/run-failure';
import './assistant-results.css';
import './assistant-editing.css';
import './assistant-panel.css';
import type { SourceEditSuggestion } from '@/lib/editor/types';
import { AssistantActivity } from './assistant-activity';
import { AssistantHistoryExpansion } from './assistant-history-pagination';

type Conversation = {projectId:Id<'projects'>;threadId:string};
type PanelProps = ComponentProps<typeof AssistantPanelBody> & {conversation?:Conversation};
type QueuedMessage={id:Id<'assistantQueue'>;prompt:string;error?:string};
type ConversationState = {queued:QueuedMessage[];queuePaused:boolean;onRemoveQueued:(id:Id<'assistantQueue'>)=>Promise<unknown>;onResumeQueue:()=>Promise<unknown>;threadId:string;messages:ChatMessage[];canLoadMore:boolean;onLoadMore:()=>void};
const LIVE_PAGE_MESSAGES=12,OPENING_MESSAGES=40;
const NO_SETTINGS:ComposerSettings={};
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
/** The failure a turn reports: the live error while this turn is current, else the one its run stored, with the code
 * stored beside it when that is the text shown. */
function turnFailure(live:string|null|undefined,request?:ChatMessage):{error?:string|null;errorCode?:RunFailureCode} {
  const error=live||request?.turnError;
  return {error,errorCode:request?.turnError&&error===request.turnError?request.turnErrorCode:undefined};
}

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

function AssistantPanelBody({ messages, running, configured, error, onSend, onRetry, onStop, hasClips, demo, onLoadMore, canLoadMore, onAttach, activity, activityStartedAt, budgetUsed, draftKey, suggestions, onSuggestion, editSnapshot, canResumeEdit=false, settings, attachments, onRemoveAttachment, composerBusy = false, requireMedia = false, conversationStarted = false, queued=[],queuePaused=false,onRemoveQueued,onResumeQueue,externalAgent,results,composerPlaceholder }: {
  externalAgent?: string | null;
  /** Shown after the last reply once nothing is running. */
  results?: ReactNode;
  composerPlaceholder?: string;
  messages: ChatMessage[]; running: boolean; editing?:boolean; configured: boolean; error?: string | null;
  /** The user's plan and the models and efforts the server offers it; they decide the pickers and what a message asks for (assistant-composer-controls.tsx). */
  settings?: ComposerSettings;
  onSend: (text: string, modelChoice?: ClaudeModelChoice, reasoningEffort?: EditorReasoningEffort, speedMode?: EditorSpeedMode) => Promise<void>; hasClips: boolean; demo: boolean;
  onRetry?: (promptMessageId:string) => Promise<void>;
  onLoadMore?: () => void; canLoadMore?: boolean; onAttach?: () => void;
  attachments?: ComposerAttachment[]; onRemoveAttachment?: (id: string) => void; composerBusy?: boolean; requireMedia?: boolean;
  /** Playback URLs for reference breakdown cards, by asset id. */
  conversationStarted?: boolean;queued?:QueuedMessage[];queuePaused?:boolean;onRemoveQueued?:(id:Id<'assistantQueue'>)=>Promise<unknown>;onResumeQueue?:()=>Promise<unknown>;
  activity?: string | null; activitySource?: string | null; activityProgress?:number|null; activityStartedAt?:number|null; draftKey?:string;
  /** Share of this request's token cap used; the working block warns from 70%. */
  budgetUsed?: number;
  onStop?: () => Promise<void>;
  suggestions?: { sourceName:string;clipId:string;items:SourceEditSuggestion[] };
  onSuggestion?: (prompt:string,clipId:string,modelChoice?:ClaudeModelChoice,reasoningEffort?:EditorReasoningEffort,speedMode?:EditorSpeedMode) => Promise<void>;
  canResumeEdit?:boolean;
  editSnapshot?:AssistantEditSnapshot;
}) {
  const [prompt, setPrompt] = useState('');
  const sendInFlight=useRef(false);
  const currentDraftKey=useRef(draftKey);currentDraftKey.current=draftKey;
  const [sending, setSending] = useState(false);
  const [resumingTurnId,setResumingTurnId]=useState<string|null>(null);
  const [localError, setLocalError] = useState('');
  const [stopState,setStopState]=useState<'stopping'|'stopped'|null>(null);
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  // An MCP agent's work is not a reply in this chat; it shows as one centered notice instead.
  const answering = (running && !externalAgent) || sending || !!pendingReply || !!resumingTurnId;
  const composerControls = useAssistantComposerControls({ settings: settings ?? NO_SETTINGS, disabled: composerBusy || sending || !!pendingReply });
  const ask = composerControls.request;
  const waiting = answering || (!externalAgent && !!activity);
  const latestUser = messages.findLast(message => message.role === 'user');
  const optimisticRequest = pendingReply && latestUser?.id === pendingReply.previousUserId ? pendingReply : null;
  // A long tool run can fill a page before its user message is loaded.
  // The visible assistant-only prefix is still the active turn, not a failed historical edit.
  const turnId = optimisticRequest?.id ?? resumingTurnId ?? messages.findLast(message=>message.role==='user'&&message.turnState==='running')?.id ?? latestUser?.id ?? messages[0]?.id ?? 'imported';
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
      const presentation=assistantTurnPresentation(replies,cards,{receipt:publicationReceipt,active:group.id===turnId&&answering,recovered:group.messages.some(message=>message.role==='user'&&message.turnState==='completed'),...turnFailure(group.id===turnId?(localError||(!waiting?error:null)):null,group.messages.find(message=>message.role==='user'))});
      return {...group,comparison,...presentation,run:turnActivity(presentation.replies,group.id===turnId&&waiting)};
    });
  },[messages,turnId,editSnapshot,running,error,localError,waiting,optimisticRequest,answering]);
  const reportedFailures=useRef(new Set<string>());
  useEffect(()=>{
    for(const group of groups)for(const card of group.cards){
      if(card.state!=='error'||reportedFailures.current.has(group.id+card.key))continue;
      reportedFailures.current.add(group.id+card.key);
      reportClientIncident({source:'editor-chat',kind:card.title==='Save not confirmed'?'save-confirmation':'turn-failure',message:`${card.title}: ${card.detail}`,context:{location:'components/editor/assistant-panel:failure-card',turnId:group.id}});
    }
  },[groups]);
  const retryTurnId=canResumeEdit?groups.findLast(group=>group.cards.some(card=>card.key==='turn-failure'))?.id:turnId;
  const showSuggestions=!conversationStarted&&!latestUser&&!waiting&&!externalAgent;
  const visibleError=!groups.length?(localError||(!waiting?error:null)):null;
  useEffect(() => { try { setPrompt(draftKey ? storedDraftText(draftKey) : ''); } catch { setPrompt(''); } }, [draftKey]);
  useEffect(() => {
    if (!pendingReply) return;
    const newUser = latestUser && latestUser.id !== pendingReply.previousUserId;
    const replied = newUser && messages.slice(messages.indexOf(latestUser) + 1).some(message => message.role !== 'user' && (message.text || message.steps?.length || message.tools?.length || message.status === 'success' || message.status === 'failed' || message.status === 'aborted'));
    if ((newUser && (running || replied)) || (error && error !== pendingReply.previousError)) setPendingReply(null);
  }, [messages, running, error, pendingReply]);
  function changePrompt(value: string) { setPrompt(value); try { if (draftKey) storeDraftText(draftKey, value); } catch { /* Keep the live draft when storage is unavailable. */ } }

  async function stop() {
    setLocalError('');
    setStopState('stopping');
    try { await onStop?.(); setStopState('stopped'); }
    catch (e) { setStopState(null); setLocalError(userError(e, 'Could not stop this edit.')); }
  }

  async function sendRequest(draft: string) {
    if (!draft.trim() || sendInFlight.current || sending || (!conversationStarted&&running) || pendingReply) return;
    const key=draftKey;sendInFlight.current=true;
    changePrompt('');
    setStopState(null); setSending(true); if(!running&&!queued.length)setPendingReply({ id: `pending-${crypto.randomUUID()}`, text: draft.trim(), previousUserId: latestUser?.id, previousError: error }); setLocalError('');
    try { await onSend(draft.trim(), ask.modelChoice, ask.reasoningEffort); }
    catch (e) { if(currentDraftKey.current===key){changePrompt(draft);setPendingReply(null);setLocalError(userError(e, 'Could not send message'));} }
    finally { sendInFlight.current=false;setSending(false); }
  }
  async function retryRequest(request:ChatMessage) {
    if(!onRetry||sendInFlight.current||answering)return;
    sendInFlight.current=true;setResumingTurnId(request.id);setLocalError('');setStopState(null);
    try { await onRetry(request.sourceId??request.id); }
    catch(error){setLocalError(userError(error,'Could not resume this request.'));}
    finally {sendInFlight.current=false;setResumingTurnId(null);}
  }
  async function submit() { await sendRequest(prompt); }

  async function chooseSuggestion(suggestion: SourceEditSuggestion) {
    if (!suggestions || !onSuggestion || sendInFlight.current || sending || running || pendingReply || !configured) return;
    const request = `${suggestion.prompt}\n\nUse the selected clip from “${suggestions.sourceName}”, source ${suggestion.start.toFixed(2)}–${suggestion.end.toFixed(2)} seconds.`;
    sendInFlight.current=true;setStopState(null); setSending(true); setPendingReply({ id: `pending-${crypto.randomUUID()}`, text: request, previousUserId: latestUser?.id, previousError: error }); setLocalError('');
    try { await onSuggestion(request, suggestions.clipId, ask.modelChoice, ask.reasoningEffort); }
    catch (e) { setPendingReply(null); setLocalError(userError(e, 'Could not start this edit.')); }
    finally { sendInFlight.current=false;setSending(false); }
  }

  return <div className="assistant-content">
    <MessageScroller><MessageScrollerViewport>
      <MessageScrollerContent className="gap-6 pt-0 pb-6">
      {canLoadMore && <Button variant="ghost" size="sm" className="load-more" onClick={() => onLoadMore?.()}>Earlier messages</Button>}
      {!messages.length && !waiting && !externalAgent && !suggestions?.items.length && !results && <Empty className="assistant-welcome h-full"><EmptyHeader><EmptyTitle>What are we making?</EmptyTitle><EmptyDescription>{hasClips ? 'A tighter cut, a stronger opening, subtitles. Tell me what you have in mind.' : 'Bring your footage, and tell me the story you want to make.'}</EmptyDescription></EmptyHeader>{!demo&&!configured&&<EmptyContent><p className="assistant-demo-note">AI editing is temporarily unavailable. Your footage, preview, and timeline are ready.</p></EmptyContent>}</Empty>}
      {groups.map(group => {
        const groupMessages = group.messages;
        const replies = group.replies;
        const editing = group.id === turnId && waiting;
        const cards = group.cards;
        const requestMessage=groupMessages.find(message=>message.role==='user');
        const run=group.run;
        // As in shadcn Chat: each person's message is its own anchored item; the reply is the item after it.
        return <Fragment key={turnKey(group.id)}>
          {groupMessages.filter(message => message.role === 'user').map(message => <MessageScrollerItem key={turnKey(message.id)} messageId={turnKey(message.id)} scrollAnchor data-message-id={message.id} data-message-status={message.status}>
            <Message align="end"><MessageContent><Bubble align="end" variant="muted"><BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent></Bubble></MessageContent></Message>
          </MessageScrollerItem>)}
          {(replies.length > 0 || editing || cards.length > 0) && <MessageScrollerItem messageId={`${turnKey(group.id)}-reply`} data-turn-id={group.id}>
            <Message><MessageContent className="gap-3">
              {/* One Thought for all of the run's reasoning and one list of its steps, both collapsed; the reply follows. */}
              <RunThought entries={run.thought} latest={run.latestThought} active={editing}/>
              <RunSteps steps={run.steps} active={editing}/>
              {run.reply.map(text => <AssistantResponseText key={text.key} text={text.text} streaming={text.streaming}/>)}
              {/* Cards that need the user stay open: they are part of the reply, not of the run. */}
              {run.steps.flatMap(step => { const ask = choiceOf(step); return ask ? [<ChoiceCard key={`ask-${step.key}`} question={ask.question} choices={ask.choices} disabled={running || sending || !!pendingReply} onChoose={group === groups.at(-1) && !running ? reply => void sendRequest(reply) : undefined}/>] : []; })}
              {run.steps.flatMap(step => { const proposalId = postProposalOf(step); return proposalId ? [<PostConfirmCard key={`post-${step.key}`} proposalId={proposalId} disabled={running || sending}/>] : []; })}
              {run.steps.flatMap(step => { const proposalId = exportProposalOf(step); return proposalId ? [<ExportConfirmCard key={`export-${step.key}`} proposalId={proposalId} disabled={running || sending}/>] : []; })}
              {replies.some(message => message.id === demoNoteMessageId) && <div className="assistant-demo-note">Sample conversation. Explore the timeline, or <a href={NEW_PROJECT_PATH}>start your own project</a>.</div>}
              {/* The model and effort the server recorded for this turn's run, not what the composer asked for. */}
              {requestMessage?.turnModel && <p className="assistant-turn-model text-[11px] text-neutral-500" data-turn-model={requestMessage.turnModel} data-turn-effort={requestMessage.turnEffort}>{editorModelLabel(requestMessage.turnModel)}{requestMessage.turnEffort && requestMessage.turnEffort in EDITOR_EFFORT_LABELS ? ` · ${EDITOR_EFFORT_LABELS[requestMessage.turnEffort as keyof typeof EDITOR_EFFORT_LABELS]}` : ''}</p>}
              {cards.some(card=>card.state!=='done'&&card.state!=='running') && <div className="assistant-result-cards" aria-label="Edit results">{cards.filter(card=>card.state!=='done'&&card.state!=='running').map(card => <div key={card.key} className={`assistant-result-card result-${card.state}${card.staged ? ' result-prepared' : ''}`}>
                <AssistantActivity label={card.title} detail={card.detail} state={card.state==='running'?'working':card.state==='error'?'error':'ready'}/>
                {card.key==='turn-failure' && group.id===retryTurnId && requestMessage?.text.trim() && !waiting && !demo && onRetry && <Button type="button" variant="outline" size="sm" disabled={composerBusy || !configured || sending || !!pendingReply} onClick={() => requestMessage&&void retryRequest(requestMessage)}><RotateCcw aria-hidden="true"/>Retry unfinished steps</Button>}
              </div>)}</div>}
              {/* The Thought and step rows already say what the run is doing; this line is for stopping, resuming, the budget, or a run that has shown nothing yet. */}
              {(()=>{const now=liveActivity(replies),label=stopState==='stopping'?'Stopping…':resumingTurnId===group.id||requestMessage?.turnResuming&&now.label==='Working'?'Resuming…':now.label,budget=budgetUsed!==undefined&&budgetUsed>=.7?`Near this request's limit · ${Math.round(budgetUsed*100)}% used`:undefined;return <AssistantReplyHeader loading active={editing&&(label==='Stopping…'||label==='Resuming…'||!!budget||!run.steps.length&&!run.thought.length&&!run.reply.length)} label={label} detail={budget??now.detail} startedAt={activityStartedAt}/>;})()}
            </MessageContent></Message>
          </MessageScrollerItem>}
        </Fragment>;
      })}
      {!groups.length && waiting && <div className="assistant-reply"><AssistantReplyHeader loading label={stopState==='stopping'?'Stopping…':'Working'} startedAt={activityStartedAt}/></div>}
      {results && !waiting && !externalAgent && <div data-chat-follow className="assistant-chat-results">{results}</div>}
      {externalAgent && <div data-chat-follow data-alone={!groups.length||undefined} className="assistant-agent-notice" role="status"><span>Connected through <McpLogo className="assistant-agent-logo"/> MCP</span><strong><AgentLogo name={externalAgent} className="assistant-agent-logo"/>{externalAgent} is working</strong></div>}
      {!waiting && stopState==='stopped'  && <AssistantActivity label="Stopped." detail="What was saved is listed above." state="stopped"/>}
      {showSuggestions && suggestions?.items.length && onSuggestion && configured ? <div data-chat-follow className="assistant-source-suggestions" aria-label="Suggested edits from this footage"><span title={suggestions.sourceName}><Lightbulb size={12} aria-hidden="true" />Ideas for {suggestions.sourceName}</span>{suggestions.items.map((suggestion, index) => <button key={`${suggestions.clipId}-${index}`} type="button" disabled={composerBusy || sending || !!pendingReply} onClick={() => void chooseSuggestion(suggestion)}><span>{suggestion.label}</span><ArrowUpRight size={14} aria-hidden="true" /></button>)}</div> : null}
      {visibleError && <div data-chat-follow><AssistantActivity className="chat-error" label="Needs attention" detail={assistantErrorDetail(visibleError)} state="error"/></div>}
      {!!messages.length && !demo && !configured && <div className="assistant-demo-note">AI editing is temporarily unavailable. Your footage, preview, and timeline are ready.</div>}
      </MessageScrollerContent>
    </MessageScrollerViewport><MessageScrollerButton /></MessageScroller>
    <div className="manual-composer-dock">
    {!demo&&<AiUsageBanner/>}
    {queued.length>0&&<div className="assistant-queue" aria-label="Queued messages"><div className="assistant-queue-heading"><span>{queued.length} queued{queuePaused?' · paused':''}</span>{queuePaused&&onResumeQueue&&<button type="button" onClick={()=>void onResumeQueue().catch(e=>setLocalError(userError(e,'Could not resume the queue.')))}>Resume queue</button>}</div>{queued.map((message,index)=><div className="assistant-queued-message" key={message.id}><span className="assistant-queue-number">{index+1}</span><div><p>{message.prompt}</p>{message.error&&<small>{message.error}</small>}</div><button type="button" aria-label={`Remove queued message ${index+1}`} onClick={()=>void onRemoveQueued?.(message.id).catch(e=>setLocalError(userError(e,'Could not remove queued message.')))}><X size={13}/></button></div>)}</div>}
    <EditComposer appearance="flat" slashCommands allowQueue={conversationStarted&&!demo} attachments={attachments} onRemoveAttachment={onRemoveAttachment} requireMedia={requireMedia} actions={composerControls.actions} variant="compact" className="manual-editor-composer" value={prompt} onChange={changePrompt} onSubmit={submit} onAttach={onAttach} placeholder={externalAgent ? `${externalAgent} is editing over MCP. What you send runs when it finishes.` : composerPlaceholder ?? "What would you change next?"} disabled={composerBusy || sending || !!pendingReply} running={running && !externalAgent} onStop={onStop ? stop : undefined} stopping={stopState==='stopping'} />
    </div>
  </div>;
}
