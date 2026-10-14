'use client';

import { useState, useEffect, useMemo } from 'react';
import { Check, ArrowUpRight, Undo2 } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { EditComposer } from '@/components/workspace/edit-composer';
import { ChatProse } from './chat-prose';
import { useConversationScroll } from '@/components/workspace/use-conversation-scroll';
import { savedEditComparison, summarizeTools, type AssistantEditSnapshot, type ChatTool } from './assistant-results';
import './assistant-results.css';
import './assistant-editing.css';
import './assistant-panel.css';
import type { SourceEditSuggestion } from '@/lib/editor/types';
import { ProcessingStatus, processingDetail } from './processing-status';
export type { ChatTool } from './assistant-results';

export type ChatMessage = { id: string; role: string; text: string; status?: string; tools?: string[]; steps?: ChatTool[] };
type PendingReply = { id: string; text: string; previousUserId?: string; previousError?: string | null };

function AssistantReplyHeader({ loading, label, detail }: { loading: boolean; label: string; detail?: string }) {
  return <div className={`assistant-reply-header ${loading ? 'is-processing' : 'chat-author'}`}>
    <Brand markOnly/>
    {loading ? <ProcessingStatus label={label} detail={detail} brand={false}/> : <span>Revline</span>}
  </div>;
}

function AssistantResponseText({ text, streaming }: { text: string; streaming: boolean }) {
  const [receivedLive, setReceivedLive] = useState(streaming);
  if (streaming && !receivedLive) setReceivedLive(true);
  // Keep the last received chunks fading after Convex marks the message complete.
  // A historical message mounts with this off, so opening a chat never replays it.
  return <ChatProse text={text} animate={receivedLive || streaming} />;
}

export function AssistantPanel({ messages, running, configured, error, onSend, onStop, hasClips, demo, onLoadMore, canLoadMore, onAttach, activity, activitySource, activityProgress, draftKey, suggestions, onSuggestion, editSnapshot, onUndo }: {
  messages: ChatMessage[]; running: boolean; configured: boolean; error?: string | null;
  onSend: (text: string) => Promise<void>; hasClips: boolean; demo: boolean;
  onLoadMore?: () => void; canLoadMore?: boolean; onAttach?: () => void;
  activity?: string | null; activitySource?: string | null; activityProgress?:number|null; draftKey?:string;
  onStop?: () => Promise<void>;
  suggestions?: { sourceName:string;clipId:string;items:SourceEditSuggestion[] };
  onSuggestion?: (prompt:string,clipId:string) => Promise<void>;
  editSnapshot?:AssistantEditSnapshot;onUndo?:()=>void|Promise<void>;
}) {
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState('');
  const [undoing,setUndoing]=useState(false);
  const [stopState,setStopState]=useState<'stopping'|'stopped'|null>(null);
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  const answering = running || sending || !!pendingReply;
  const waiting = answering || !!activity;
  const latestUser = messages.findLast(message => message.role === 'user');
  const optimisticRequest = pendingReply && latestUser?.id === pendingReply.previousUserId ? pendingReply : null;
  const turnId = optimisticRequest?.id ?? latestUser?.id ?? 'imported';
  const demoNoteMessageId = demo ? messages.findLast(message => message.role === 'assistant')?.id : undefined;
  const scroll = useConversationScroll(turnId, true, false);
  const groups=useMemo(()=>{
    const turns:{id:string;messages:ChatMessage[]}[]=[];
    for(const message of messages){if(message.role==='user'||!turns.length)turns.push({id:message.id,messages:[]});turns.at(-1)!.messages.push(message);}
    if (optimisticRequest) turns.push({id:optimisticRequest.id,messages:[{id:optimisticRequest.id,role:'user',text:optimisticRequest.text}]});
    return turns.map(group=>{
      const replies=group.messages.filter(message=>message.role!=='user'),steps=group.messages.flatMap(message=>message.steps??[]);
      const comparison=group.id===turnId?savedEditComparison(steps,editSnapshot):null;
      const draftFailed=!running&&group.id===turnId&&(!!error||replies.some(message=>message.status==='failed'||message.status==='aborted'));
      return {...group,replies,comparison,cards:summarizeTools(steps,{publishedRevision:comparison?.publishedRevision,draftFailed})};
    });
  },[messages,turnId,editSnapshot,running,error,optimisticRequest]);
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
    catch (e) { setStopState(null); setLocalError(e instanceof Error ? e.message : 'Could not stop this edit.'); }
  }

  async function submit() {
    if (!prompt.trim() || sending || running || pendingReply) return;
    setStopState(null); setSending(true); setPendingReply({ id: `pending-${crypto.randomUUID()}`, text: prompt.trim(), previousUserId: latestUser?.id, previousError: error }); setLocalError(''); scroll.resume();
    try { await onSend(prompt.trim()); setPrompt(''); try { if (draftKey) sessionStorage.removeItem(draftKey); } catch { /* The message was sent successfully. */ } }
    catch (e) { setPendingReply(null); setLocalError(e instanceof Error ? e.message : 'Could not send message'); }
    finally { setSending(false); }
  }

  async function chooseSuggestion(suggestion: SourceEditSuggestion) {
    if (!suggestions || !onSuggestion || sending || running || pendingReply || !configured) return;
    const request = `${suggestion.prompt}\n\nUse the selected clip from “${suggestions.sourceName}”, source ${suggestion.start.toFixed(2)}–${suggestion.end.toFixed(2)} seconds.`;
    setStopState(null); setSending(true); setPendingReply({ id: `pending-${crypto.randomUUID()}`, text: request, previousUserId: latestUser?.id, previousError: error }); setLocalError(''); scroll.resume();
    try { await onSuggestion(request, suggestions.clipId); }
    catch (e) { setPendingReply(null); setLocalError(e instanceof Error ? e.message : 'Could not start this edit.'); }
    finally { setSending(false); }
  }

  async function undoEdit(){
    if(undoing||waiting||!groups.at(-1)?.comparison?.canUndo||!onUndo)return;
    setUndoing(true);setLocalError('');
    try{await onUndo();}catch(reason){setLocalError(reason instanceof Error?reason.message:'Could not undo this edit.');}finally{setUndoing(false);}
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
            <AssistantReplyHeader loading={loading} label={stopState==='stopping'?'Stopping…':activity || 'Editing…'} detail={processingDetail(activity,activitySource)}/>
            {replies.map(message => !message.text && !message.tools?.length && message.id !== demoNoteMessageId ? null : <article key={message.id} data-message-id={message.id} data-message-status={message.status} className="chat-message chat-assistant">
              {message.text && <AssistantResponseText text={message.text} streaming={message.status === 'streaming'} />}
              {message.tools?.map((tool, i) => <div className="tool-result" key={`${tool}-${i}`}><Check size={12} />{tool}</div>)}
              {message.id === demoNoteMessageId && <div className="assistant-demo-note">Sample conversation. Explore the timeline, or <a href="/projects">start your own project</a>.</div>}
            </article>)}
            {cards.length > 0 && <div className="assistant-result-cards" aria-label="Edit results">{cards.filter(card=>!(card.state==='running'&&(editing||(group.id===turnId&&stopState==='stopped')))).map(card => <div key={card.key} className={`assistant-result-card result-${card.state}${card.staged ? ' result-prepared' : ''}`}>
              <ProcessingStatus label={card.title} detail={card.detail} state={card.state==='running'?'working':card.state==='error'?'error':'ready'} brand={false}/>
            </div>)}</div>}
            {group.comparison&&<>{onUndo&&<button type="button" className="assistant-undo-edit" disabled={!group.comparison.canUndo||waiting||undoing} title={group.comparison.canUndo?'Undo the latest edit':'This saved edit is no longer the latest undoable change'} onClick={()=>void undoEdit()}><Undo2 size={14}/>{undoing?'Undoing…':'Undo'}</button>}</>}
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
    <EditComposer variant="compact" className="manual-editor-composer" value={prompt} onChange={changePrompt} onSubmit={submit} onAttach={onAttach} placeholder="What would you change next?" disabled={sending || !!pendingReply} running={running} onStop={onStop ? stop : undefined} />
    </div>
  </div>;
}
