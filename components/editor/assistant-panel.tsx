'use client';

import { useState, useEffect } from 'react';
import { LoaderCircle, Check, CircleAlert } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { EditComposer } from '@/components/workspace/edit-composer';
import { ChatProse } from './chat-prose';
import { useConversationScroll } from '@/components/workspace/use-conversation-scroll';
import { summarizeTools, type ChatTool } from './assistant-results';
import './assistant-results.css';
export type { ChatTool } from './assistant-results';

export type ChatMessage = { id: string; role: string; text: string; status?: string; tools?: string[]; steps?: ChatTool[] };

function AssistantResponseText({ text, streaming }: { text: string; streaming: boolean }) {
  const [receivedLive, setReceivedLive] = useState(streaming);
  if (streaming && !receivedLive) setReceivedLive(true);
  // Keep the last received chunks fading after Convex marks the message complete.
  // A historical message mounts with this off, so opening a chat never replays it.
  return <ChatProse text={text} animate={receivedLive || streaming} />;
}

export function AssistantPanel({ messages, running, configured, error, onSend, onStop, hasClips, demo, onLoadMore, canLoadMore, onAttach, activity, draftKey }: {
  messages: ChatMessage[]; running: boolean; configured: boolean; error?: string | null;
  onSend: (text: string) => Promise<void>; hasClips: boolean; demo: boolean;
  onLoadMore?: () => void; canLoadMore?: boolean; onAttach?: () => void;
  activity?: string | null; draftKey?:string;
  onStop?: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState('');
  const turnId = messages.findLast(message => message.role === 'user')?.id ?? 'imported';
  const demoNoteMessageId = demo ? messages.findLast(message => message.role === 'assistant')?.id : undefined;
  const scroll = useConversationScroll(turnId, true, false);
  const groups: { id: string; indices: number[] }[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role === 'user' || !groups.length) groups.push({ id: message.id, indices: [] });
    groups.at(-1)!.indices.push(index);
  }
  useEffect(() => { try { setPrompt(draftKey ? sessionStorage.getItem(draftKey) ?? '' : ''); } catch { setPrompt(''); } }, [draftKey]);
  function changePrompt(value: string) { setPrompt(value); try { if (draftKey) sessionStorage.setItem(draftKey, value); } catch { /* Keep the live draft when storage is unavailable. */ } }

  async function stop() {
    setLocalError('');
    try { await onStop?.(); }
    catch (e) { setLocalError(e instanceof Error ? e.message : 'Could not stop this edit.'); }
  }

  async function submit() {
    if (!prompt.trim() || sending || running) return;
    setSending(true); setLocalError(''); scroll.resume();
    try { await onSend(prompt.trim()); setPrompt(''); try { if (draftKey) sessionStorage.removeItem(draftKey); } catch { /* The message was sent successfully. */ } }
    catch (e) { setLocalError(e instanceof Error ? e.message : 'Could not send message'); }
    finally { setSending(false); }
  }

  return <div className="assistant-content">
    <div ref={scroll.viewport} className={`assistant-history ${!messages.length ? 'assistant-history-empty' : ''}`}>
      <div className="assistant-turns" ref={scroll.content}>
      {canLoadMore && <button className="load-more" onClick={() => { scroll.preserveHistory(); onLoadMore?.(); }}>Earlier messages</button>}
      {!messages.length && <div className="assistant-welcome"><h3>What are we making?</h3><p>{hasClips ? 'A tighter cut, a stronger opening, subtitles. Tell me what you have in mind.' : 'Bring your footage, and tell me the story you want to make.'}</p>{!demo&&!configured&&<div className="assistant-demo-note">Connect Claude to edit in conversation. Your footage, preview, and timeline are ready.</div>}</div>}
      {groups.map(group => <div className={`assistant-turn ${group.id === turnId ? 'is-latest-turn' : ''}`} data-turn-id={group.id} key={group.id}>{group.indices.map(index => {
        const m = messages[index];
        return <article key={m.id} data-message-id={m.id} className={`chat-message ${m.role === 'user' ? 'chat-user' : 'chat-assistant'}`}>
        {m.role !== 'user' && messages[index-1]?.role !== m.role && <div className="chat-author"><Brand markOnly /><span>Revline</span></div>}
        {m.text && (m.role === 'user' ? <p>{m.text}</p> : <AssistantResponseText text={m.text} streaming={m.status === 'streaming'} />)}
        {m.tools?.map((tool, i) => <div className="tool-result" key={`${tool}-${i}`}><Check size={12} />{tool}</div>)}
        {m.id === demoNoteMessageId && <div className="assistant-demo-note">Sample conversation. Explore the timeline, or <a href="/projects">start your own project</a>.</div>}
      </article>;
      })}{(() => {
        const cards = summarizeTools(group.indices.flatMap(index => messages[index].steps ?? []));
        return cards.length ? <div className="assistant-result-cards" aria-label="Edit results">{cards.map(card => <div key={card.key} className={`assistant-result-card result-${card.state}${card.staged ? ' result-prepared' : ''}`}>
          {card.state === 'running' ? <LoaderCircle size={14} className="animate-spin" /> : card.state === 'error' ? <CircleAlert size={14} /> : <Check size={14} />}
          <div><span>{card.title}</span>{card.detail && <small>{card.detail}</small>}</div>
        </div>)}</div> : null;
      })()}{group.id === turnId && (running || activity) && <div className="assistant-thinking"><LoaderCircle size={13} className="animate-spin" />{activity || 'Shaping your edit…'}</div>}</div>)}
      {!messages.length && (running || activity) && <div className="assistant-thinking"><LoaderCircle size={13} className="animate-spin" />{activity || 'Shaping your edit…'}</div>}
      {(error || localError) && <p className="chat-error" role="alert">{localError || error}</p>}
      {!!messages.length && !demo && !configured && <div className="assistant-demo-note">Connect Claude to edit in conversation. Your footage, preview, and timeline are ready.</div>}
      </div>
    </div>
    <div ref={scroll.composer} className="manual-composer-dock">
    {scroll.latestHidden && <button className="chat-jump-latest" onClick={scroll.resume}>Latest response</button>}
    <EditComposer className="manual-editor-composer" value={prompt} onChange={changePrompt} onSubmit={submit} onAttach={onAttach} placeholder="Tell me what to make." disabled={sending} running={running} onStop={onStop ? stop : undefined} />
    </div>
  </div>;
}
