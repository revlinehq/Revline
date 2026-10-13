'use client';

import { useState, useEffect } from 'react';
import { LoaderCircle, Check, CircleAlert, ArrowUpRight } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { EditComposer } from '@/components/workspace/edit-composer';
import { ChatProse, type ReplyTextAppearance } from './chat-prose';
import { useConversationScroll } from '@/components/workspace/use-conversation-scroll';
import { summarizeTools, type ChatTool } from './assistant-results';
import './assistant-results.css';
import './assistant-text-preference.css';
import './assistant-editing.css';
import type { SourceEditSuggestion } from '@/lib/editor/types';
export type { ChatTool } from './assistant-results';

export type ChatMessage = { id: string; role: string; text: string; status?: string; tools?: string[]; steps?: ChatTool[] };

const TEXT_APPEARANCE_STORAGE_KEY = 'revline:reply-text-appearance:v1';

function AssistantResponseText({ text, streaming, appearance }: { text: string; streaming: boolean; appearance: ReplyTextAppearance }) {
  const [receivedLive, setReceivedLive] = useState(streaming);
  if (streaming && !receivedLive) setReceivedLive(true);
  // Keep the last received chunks fading after Convex marks the message complete.
  // A historical message mounts with this off, so opening a chat never replays it.
  return <ChatProse text={text} animate={receivedLive || streaming} appearance={appearance} />;
}

function EditingStatus({ activity }: { activity?: string | null }) {
  return <div className="assistant-editing" role="status"><span className="assistant-editing-text">{activity || 'Editing…'}</span></div>;
}

export function AssistantPanel({ messages, running, configured, error, onSend, onStop, hasClips, demo, onLoadMore, canLoadMore, onAttach, activity, draftKey, suggestions, onSuggestion }: {
  messages: ChatMessage[]; running: boolean; configured: boolean; error?: string | null;
  onSend: (text: string) => Promise<void>; hasClips: boolean; demo: boolean;
  onLoadMore?: () => void; canLoadMore?: boolean; onAttach?: () => void;
  activity?: string | null; draftKey?:string;
  onStop?: () => Promise<void>;
  suggestions?: { sourceName:string;clipId:string;items:SourceEditSuggestion[] };
  onSuggestion?: (prompt:string,clipId:string) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState('');
  const [pendingReply, setPendingReply] = useState<{ previousMessageId?:string;previousError?:string|null } | null>(null);
  const waiting = running || sending || !!pendingReply || !!activity;
  // Reply fades are the editor default; Follow system and Instant remain opt-outs.
  const [textAppearance, setTextAppearance] = useState<ReplyTextAppearance>('fade');
  const turnId = messages.findLast(message => message.role === 'user')?.id ?? 'imported';
  const demoNoteMessageId = demo ? messages.findLast(message => message.role === 'assistant')?.id : undefined;
  const scroll = useConversationScroll(turnId, true, false);
  const groups: { id: string; indices: number[] }[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role === 'user' || !groups.length) groups.push({ id: message.id, indices: [] });
    groups.at(-1)!.indices.push(index);
  }
  useEffect(() => { try { setPrompt(draftKey ? sessionStorage.getItem(draftKey) ?? '' : ''); } catch { setPrompt(''); } }, [draftKey]);
  useEffect(() => {
    if (!pendingReply) return;
    const last = messages.at(-1);
    const replied = last && last.role !== 'user' && last.id !== pendingReply.previousMessageId && (last.text || last.steps?.length || last.tools?.length);
    if (running || replied || (error && error !== pendingReply.previousError)) setPendingReply(null);
  }, [messages, running, error, pendingReply]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TEXT_APPEARANCE_STORAGE_KEY);
      setTextAppearance(saved === 'fade' || saved === 'instant' || saved === 'system' ? saved : 'fade');
    } catch { /* Keep the editor default when local storage is unavailable. */ }
  }, []);
  function changeTextAppearance(value: ReplyTextAppearance) {
    setTextAppearance(value);
    try { localStorage.setItem(TEXT_APPEARANCE_STORAGE_KEY, value); } catch { /* Keep the chosen appearance for this session. */ }
  }
  function changePrompt(value: string) { setPrompt(value); try { if (draftKey) sessionStorage.setItem(draftKey, value); } catch { /* Keep the live draft when storage is unavailable. */ } }

  async function stop() {
    setLocalError('');
    try { await onStop?.(); }
    catch (e) { setLocalError(e instanceof Error ? e.message : 'Could not stop this edit.'); }
  }

  async function submit() {
    if (!prompt.trim() || sending || running || pendingReply) return;
    setSending(true); setPendingReply({ previousMessageId: messages.at(-1)?.id, previousError: error }); setLocalError(''); scroll.resume();
    try { await onSend(prompt.trim()); setPrompt(''); try { if (draftKey) sessionStorage.removeItem(draftKey); } catch { /* The message was sent successfully. */ } }
    catch (e) { setPendingReply(null); setLocalError(e instanceof Error ? e.message : 'Could not send message'); }
    finally { setSending(false); }
  }

  async function chooseSuggestion(suggestion: SourceEditSuggestion) {
    if (!suggestions || !onSuggestion || sending || running || pendingReply || !configured) return;
    setSending(true); setPendingReply({ previousMessageId: messages.at(-1)?.id, previousError: error }); setLocalError(''); scroll.resume();
    const request = `${suggestion.prompt}\n\nUse the selected clip from “${suggestions.sourceName}”, source ${suggestion.start.toFixed(2)}–${suggestion.end.toFixed(2)} seconds.`;
    try { await onSuggestion(request, suggestions.clipId); }
    catch (e) { setPendingReply(null); setLocalError(e instanceof Error ? e.message : 'Could not start this edit.'); }
    finally { setSending(false); }
  }

  return <div className="assistant-content">
    <div ref={scroll.viewport} className={`assistant-history ${!messages.length && !waiting ? 'assistant-history-empty' : ''}`}>
      <div className="assistant-turns" ref={scroll.content}>
      {canLoadMore && <button className="load-more" onClick={() => { scroll.preserveHistory(); onLoadMore?.(); }}>Earlier messages</button>}
      {!messages.length && !waiting && !suggestions?.items.length && <div className="assistant-welcome"><h3>What are we making?</h3><p>{hasClips ? 'A tighter cut, a stronger opening, subtitles. Tell me what you have in mind.' : 'Bring your footage, and tell me the story you want to make.'}</p>{!demo&&!configured&&<div className="assistant-demo-note">Connect Claude to edit in conversation. Your footage, preview, and timeline are ready.</div>}</div>}
      {groups.map(group => {
        const groupMessages = group.indices.map(index => messages[index]);
        const replies = groupMessages.filter(message => message.role !== 'user');
        const editing = group.id === turnId && waiting;
        const cards = summarizeTools(groupMessages.flatMap(message => message.steps ?? []));
        return <div className={`assistant-turn ${group.id === turnId ? 'is-latest-turn' : ''}`} data-turn-id={group.id} key={group.id}>
          {groupMessages.filter(message => message.role === 'user').map(message => <article key={message.id} data-message-id={message.id} data-message-status={message.status} className="chat-message chat-user"><p>{message.text}</p></article>)}
          {(replies.length > 0 || editing || cards.length > 0) && <div className="assistant-reply">
            <div className="chat-author"><Brand markOnly /><span>Revline</span></div>
            {replies.map(message => !message.text && !message.tools?.length && message.id !== demoNoteMessageId ? null : <article key={message.id} data-message-id={message.id} data-message-status={message.status} className="chat-message chat-assistant">
              {message.text && <AssistantResponseText key={textAppearance} text={message.text} streaming={message.status === 'streaming'} appearance={textAppearance} />}
              {message.tools?.map((tool, i) => <div className="tool-result" key={`${tool}-${i}`}><Check size={12} />{tool}</div>)}
              {message.id === demoNoteMessageId && <div className="assistant-demo-note">Sample conversation. Explore the timeline, or <a href="/projects">start your own project</a>.</div>}
            </article>)}
            {cards.length > 0 && <div className="assistant-result-cards" aria-label="Edit results">{cards.map(card => <div key={card.key} className={`assistant-result-card result-${card.state}${card.staged ? ' result-prepared' : ''}`}>
              {card.state === 'running' ? <LoaderCircle size={14} className="animate-spin" /> : card.state === 'error' ? <CircleAlert size={14} /> : <Check size={14} />}
              <div><span>{card.title}</span>{card.detail && <small>{card.detail}</small>}</div>
            </div>)}</div>}
            {editing && <EditingStatus activity={activity} />}
          </div>}
        </div>;
      })}
      {!messages.length && waiting && <div className="assistant-reply"><div className="chat-author"><Brand markOnly /><span>Revline</span></div><EditingStatus activity={activity} /></div>}
      {!running && suggestions?.items.length && onSuggestion && configured ? <div className="assistant-source-suggestions" aria-label="Suggested edits from this footage"><span title={suggestions.sourceName}>Ideas for {suggestions.sourceName}</span>{suggestions.items.map((suggestion, index) => <button key={`${suggestions.clipId}-${index}`} type="button" disabled={sending || !!pendingReply} onClick={() => void chooseSuggestion(suggestion)}><span>{suggestion.label}</span><ArrowUpRight size={14} aria-hidden="true" /></button>)}</div> : null}
      {(error || localError) && <p className="chat-error" role="alert">{localError || error}</p>}
      {!!messages.length && !demo && !configured && <div className="assistant-demo-note">Connect Claude to edit in conversation. Your footage, preview, and timeline are ready.</div>}
      </div>
    </div>
    <div ref={scroll.composer} className="manual-composer-dock">
    {scroll.latestHidden && <button className="chat-jump-latest" onClick={scroll.resume}>Latest response</button>}
    <label className="assistant-text-preference">Reply text<select aria-label="Reply text appearance" value={textAppearance} onChange={event => changeTextAppearance(event.target.value as ReplyTextAppearance)}><option value="system">Follow system</option><option value="fade">Fade in</option><option value="instant">Instant</option></select></label>
    <EditComposer className="manual-editor-composer" value={prompt} onChange={changePrompt} onSubmit={submit} onAttach={onAttach} placeholder="Tell me what to make." disabled={sending || !!pendingReply} running={running} onStop={onStop ? stop : undefined} />
    </div>
  </div>;
}
