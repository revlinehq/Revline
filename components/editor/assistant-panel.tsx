'use client';
import { userError } from '@/lib/user-error';

import { PRODUCTION_CLAUDE_MODEL_CHOICES } from '@/lib/ai/claude-model-policy';
import { useState, useEffect, useMemo, useRef, type ComponentProps } from 'react';
import { Check, ArrowUpRight } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { AssistantModelPicker } from './assistant-model-picker';
import type { ClaudeModelChoice } from '@/lib/ai/claude-model';
import { EditComposer, type ComposerAttachment } from '@/components/workspace/edit-composer';
import { useUIMessages } from '@convex-dev/agent/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { chatMessageFromUI } from './assistant-results';
import { ChatProse } from './chat-prose';
import { useConversationScroll } from '@/components/workspace/use-conversation-scroll';
import { savedEditComparison, summarizeTools, turnPublicationReceipt, type AssistantEditSnapshot, type ChatMessage } from './assistant-results';
import './assistant-results.css';
import './assistant-editing.css';
import './assistant-panel.css';
import type { SourceEditSuggestion } from '@/lib/editor/types';
import { ProcessingStatus, processingDetail } from './processing-status';
export type { ChatTool, ChatMessage } from './assistant-results';

type Conversation = {projectId:Id<'projects'>;threadId:string};
type PanelProps = ComponentProps<typeof AssistantPanelBody> & {conversation?:Conversation};
function ConnectedConversation({conversation,...props}:PanelProps & {conversation:Conversation}) {
  const {results,status,loadMore}=useUIMessages(api.assistant.messages,conversation,{initialNumItems:20,stream:true});
  const messages=useMemo(()=>results.map(chatMessageFromUI),[results]);
  return <AssistantPanelBody {...props} messages={messages} canLoadMore={status==='CanLoadMore'} onLoadMore={()=>loadMore(20)}/>;
}
/** Stream subscriptions live inside the conversation, away from preview/timeline. */
export function AssistantPanel(props:PanelProps) {
  return props.conversation?<ConnectedConversation {...props} conversation={props.conversation}/>:<AssistantPanelBody {...props}/>;
}

type PendingReply = { id: string; text: string; previousUserId?: string; previousError?: string | null };

function AssistantReplyHeader({ loading, active=loading, label, detail }: { loading: boolean; active?:boolean; label: string; detail?: string }) {
  return <div className={`assistant-reply-header ${active ? 'is-processing' : 'chat-author'}`}>
    <Brand markOnly/>
    {active ? <ProcessingStatus label={loading?label:'Revline'} detail={loading?detail:undefined} brand={false}/> : <span>Revline</span>}
  </div>;
}

function AssistantResponseText({ text, streaming }: { text: string; streaming: boolean }) {
  const [receivedLive, setReceivedLive] = useState(streaming);
  if (streaming && !receivedLive) setReceivedLive(true);
  // Keep the last received chunks fading after Convex marks the message complete.
  // A historical message mounts with this off, so opening a chat never replays it.
  return <ChatProse text={text} animate={receivedLive || streaming} />;
}

function AssistantPanelBody({ messages, running, configured, error, onSend, onStop, hasClips, demo, onLoadMore, canLoadMore, onAttach, activity, activitySource, draftKey, suggestions, onSuggestion, editSnapshot, modelSwitcher = false, allowedModels = PRODUCTION_CLAUDE_MODEL_CHOICES, attachments, onRemoveAttachment, requireMedia = false }: {
  messages: ChatMessage[]; running: boolean; configured: boolean; error?: string | null;
  modelSwitcher?: boolean;
  allowedModels?: readonly ClaudeModelChoice[];
  onSend: (text: string, modelChoice?: ClaudeModelChoice) => Promise<void>; hasClips: boolean; demo: boolean;
  onLoadMore?: () => void; canLoadMore?: boolean; onAttach?: () => void;
  attachments?: ComposerAttachment[]; onRemoveAttachment?: (id: string) => void; requireMedia?: boolean;
  activity?: string | null; activitySource?: string | null; activityProgress?:number|null; draftKey?:string;
  onStop?: () => Promise<void>;
  suggestions?: { sourceName:string;clipId:string;items:SourceEditSuggestion[] };
  onSuggestion?: (prompt:string,clipId:string,modelChoice?:ClaudeModelChoice) => Promise<void>;
  editSnapshot?:AssistantEditSnapshot;
}) {
  const [prompt, setPrompt] = useState('');
  const sendInFlight=useRef(false);
  const currentDraftKey=useRef(draftKey);currentDraftKey.current=draftKey;
  const [modelChoice, setModelChoice] = useState<ClaudeModelChoice>('sonnet');
  const effectiveModelChoice = allowedModels.includes(modelChoice) ? modelChoice : 'sonnet';
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState('');
  const [stopState,setStopState]=useState<'stopping'|'stopped'|null>(null);
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  const answering = running || sending || !!pendingReply;
  const waiting = answering || !!activity;
  const latestUser = messages.findLast(message => message.role === 'user');
  const optimisticRequest = pendingReply && latestUser?.id === pendingReply.previousUserId ? pendingReply : null;
  const turnId = optimisticRequest?.id ?? latestUser?.id ?? 'imported';
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
      return {...group,replies,comparison,cards:summarizeTools(steps,{publicationReceipt,publishedRevision:legacyPublications.current.get(group.id),draftFailed,draftPending:group.id===turnId&&answering})};
    });
  },[messages,turnId,editSnapshot,running,error,optimisticRequest,answering]);
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
    try { await onSend(draft.trim(), modelSwitcher ? effectiveModelChoice : undefined); }
    catch (e) { if(currentDraftKey.current===key){changePrompt(draft);setPendingReply(null);setLocalError(userError(e, 'Could not send message'));} }
    finally { sendInFlight.current=false;setSending(false); }
  }

  async function chooseSuggestion(suggestion: SourceEditSuggestion) {
    if (!suggestions || !onSuggestion || sendInFlight.current || sending || running || pendingReply || !configured) return;
    const request = `${suggestion.prompt}\n\nUse the selected clip from “${suggestions.sourceName}”, source ${suggestion.start.toFixed(2)}–${suggestion.end.toFixed(2)} seconds.`;
    sendInFlight.current=true;setStopState(null); setSending(true); setPendingReply({ id: `pending-${crypto.randomUUID()}`, text: request, previousUserId: latestUser?.id, previousError: error }); setLocalError(''); scroll.resume();
    try { await onSuggestion(request, suggestions.clipId, modelSwitcher ? effectiveModelChoice : undefined); }
    catch (e) { setPendingReply(null); setLocalError(userError(e, 'Could not start this edit.')); }
    finally { sendInFlight.current=false;setSending(false); }
  }

  return <div className="assistant-content">
    <div ref={scroll.viewport} className={`assistant-history ${!messages.length && !waiting ? 'assistant-history-empty' : ''}`}>
      <div className="assistant-turns" ref={scroll.content}>
      {canLoadMore && <button className="load-more" onClick={() => { scroll.preserveHistory(); onLoadMore?.(); }}>Earlier messages</button>}
      {!messages.length && !waiting && !suggestions?.items.length && <div className="assistant-welcome"><h3>What are we making?</h3><p>{hasClips ? 'A tighter cut, a stronger opening, subtitles. Tell me what you have in mind.' : 'Bring your footage, and tell me the story you want to make.'}</p>{!demo&&!configured&&<div className="assistant-demo-note">Connect Claude to edit in conversation. Your footage, preview, and timeline are ready.</div>}</div>}
      {groups.map(group => {
        const groupMessages = group.messages;
        const replies = group.replies;
        const editing = group.id === turnId && waiting;
        const currentReply = replies.at(-1);
        const hasRunningTool = replies.some(message=>message.steps?.some(step=>step.state==='running'));
        const showingReply = !!currentReply?.text.trim() && !activity && !hasRunningTool && (currentReply.status === 'streaming' || answering);
        const loading = editing && (!showingReply || stopState === 'stopping');
        const cards = group.cards;
        return <div className={`assistant-turn ${group.id === turnId ? 'is-latest-turn' : ''}`} data-turn-id={group.id} key={group.id}>
          {groupMessages.filter(message => message.role === 'user').map(message => <article key={message.id} data-message-id={message.id} data-message-status={message.status} className="chat-message chat-user"><p>{message.text}</p></article>)}
          {(replies.length > 0 || editing || cards.length > 0) && <div className="assistant-reply">
            <AssistantReplyHeader loading={loading} active={editing} label={stopState==='stopping'?'Stopping…':activity || 'Editing…'} detail={processingDetail(activity,activitySource)}/>
            {replies.map(message => !message.text && !message.tools?.length && message.id !== demoNoteMessageId ? null : <article key={message.id} data-message-id={message.id} data-message-status={message.status} className="chat-message chat-assistant">
              {message.text && <AssistantResponseText text={message.text} streaming={message.status === 'streaming'} />}
              {message.tools?.map((tool, i) => <div className="tool-result" key={`${tool}-${i}`}><Check size={12} />{tool}</div>)}
              {message.id === demoNoteMessageId && <div className="assistant-demo-note">Sample conversation. Explore the timeline, or <a href="/projects">start your own project</a>.</div>}
            </article>)}
            {cards.length > 0 && <div className="assistant-result-cards" aria-label="Edit results">{cards.filter(card=>!(card.state==='running'&&(editing||(group.id===turnId&&stopState==='stopped')))).map(card => <div key={card.key} className={`assistant-result-card result-${card.state}${card.staged ? ' result-prepared' : ''}`}>
              <ProcessingStatus label={card.title} detail={card.detail} state={card.state==='running'?'working':card.state==='error'?'error':'ready'} brand={false}/>
            </div>)}</div>}
          </div>}
        </div>;
      })}
      {!groups.length && waiting && <div className="assistant-reply"><AssistantReplyHeader loading label={stopState==='stopping'?'Stopping…':activity || 'Editing…'} detail={processingDetail(activity,activitySource)}/></div>}
      {!waiting && stopState==='stopped' && <ProcessingStatus label="Stopped." detail="Your existing edit is still here." state="stopped"/>}
      {!running && suggestions?.items.length && onSuggestion && configured ? <div className="assistant-source-suggestions" aria-label="Suggested edits from this footage"><span title={suggestions.sourceName}>Ideas for {suggestions.sourceName}</span>{suggestions.items.map((suggestion, index) => <button key={`${suggestions.clipId}-${index}`} type="button" disabled={sending || !!pendingReply} onClick={() => void chooseSuggestion(suggestion)}><span>{suggestion.label}</span><ArrowUpRight size={14} aria-hidden="true" /></button>)}</div> : null}
      {(error || localError) && <ProcessingStatus className="chat-error" label="Couldn’t finish this step." detail={localError || error} state="error"/>}
      {!!messages.length && !demo && !configured && <div className="assistant-demo-note">Connect Claude to edit in conversation. Your footage, preview, and timeline are ready.</div>}
      </div>
    </div>
    <div ref={scroll.composer} className="manual-composer-dock">
    {scroll.latestHidden && <button className="chat-jump-latest" onClick={scroll.resume}>Latest response</button>}
    <EditComposer attachments={attachments} onRemoveAttachment={onRemoveAttachment} requireMedia={requireMedia} actions={modelSwitcher ? <AssistantModelPicker allowedModels={allowedModels} value={effectiveModelChoice} onChange={setModelChoice} disabled={answering}/> : undefined} variant="compact" className="manual-editor-composer" value={prompt} onChange={changePrompt} onSubmit={submit} onAttach={onAttach} placeholder="What would you change next?" disabled={sending || !!pendingReply} running={running} onStop={onStop ? stop : undefined} />
    </div>
  </div>;
}
