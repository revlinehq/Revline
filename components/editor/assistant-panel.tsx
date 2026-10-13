'use client';

import { useState, useEffect } from 'react';
import { LoaderCircle, Check, CircleAlert } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { EditComposer } from '@/components/workspace/edit-composer';
import { ChatProse } from './chat-prose';
import { useConversationScroll } from '@/components/workspace/use-conversation-scroll';

export type ChatTool = { name: string; state: 'running' | 'done' | 'error'; detail?: string };
export type ChatMessage = { id: string; role: string; text: string; status?: string; tools?: string[]; steps?: ChatTool[] };
const TOOL_LABELS: Record<string, string> = {
  inspectTimeline:'Checking your edit', transformClip:'Adjusting the frame', cropClip:'Cropping the footage', resetVisual:'Resetting the frame', fitClip:'Fitting the footage', styleTextClip:'Styling the text', setVolume:'Adjusting sound', addLayer:'Adding a layer',
  split: 'Splitting the clip', trim: 'Trimming footage', move: 'Arranging the timeline', delete: 'Removing a clip',
  addCaption: 'Adding a caption', addGraphic: 'Adding a title', addMedia: 'Adding footage',
  setAspectRatio: 'Resizing the canvas', followSubject: 'Following the face', editText: 'Updating the words',
  styleCaptions: 'Styling the captions', analyzeMedia: 'Reviewing your footage',
  addSubtitlesFromTranscript: 'Creating subtitles', alignCutsToBeat: 'Matching cuts to the beat',
  useStrongestMoment: 'Bringing in the strongest moment', inspectAssetAnalysis: 'Reading footage notes',
};
const COMPLETED_LABELS: Record<string,string> = {
  inspectTimeline:'Edit checked', transformClip:'Frame adjusted', cropClip:'Footage cropped', resetVisual:'Frame reset', fitClip:'Footage fitted', styleTextClip:'Text styled', setVolume:'Sound adjusted', addLayer:'Layer added',
  split: 'Clip split', trim: 'Footage trimmed', move: 'Timeline arranged', delete: 'Clip removed',
  addCaption: 'Caption added', addGraphic: 'Title added', addMedia: 'Footage added',
  setAspectRatio: 'Canvas resized', followSubject: 'Face following applied', editText: 'Words updated',
  styleCaptions: 'Captions styled', analyzeMedia: 'Footage reviewed', addSubtitlesFromTranscript: 'Subtitles added',
  alignCutsToBeat: 'Cuts matched to the beat', useStrongestMoment: 'Moment added', inspectAssetAnalysis: 'Footage notes read',
};

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
        {m.steps?.map((step, i) => <div className={`tool-result tool-${step.state}`} key={`${step.name}-${i}`}>
          {step.state === 'running' ? <LoaderCircle size={12} className="animate-spin" /> : step.state === 'error' ? <CircleAlert size={12} /> : <Check size={12} />}
          <span>{(step.state==='done'?COMPLETED_LABELS[step.name]:TOOL_LABELS[step.name]) ?? step.name.replace(/([A-Z])/g, ' $1')}{(step.state==='error'||step.detail)&&<small>{step.state === 'error' ? 'Could not finish this step' : step.detail}</small>}</span>
        </div>)}
        {m.id === demoNoteMessageId && <div className="assistant-demo-note">Sample conversation. Explore the timeline, or <a href="/projects">start your own project</a>.</div>}
      </article>;
      })}{group.id === turnId && (running || activity) && <div className="assistant-thinking"><LoaderCircle size={13} className="animate-spin" />{activity || 'Shaping your edit…'}</div>}</div>)}
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
