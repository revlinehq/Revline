import { ArrowUp, AudioLines, ChevronDown, ChevronRight, Mic, Plus, SlidersHorizontal } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { ClaudeLogo, OpenAILogo } from '@/components/workspace/ai-app-logos';
import './agent-chats.css';

// The same request driven through Revline's MCP connector from Claude and from ChatGPT, rebuilt in each app's own chat UI.
const SCREENSHOTS = [
  { src: '/landing/editor/t3-new-thread.webp', name: 'T3 Code new thread.png' },
  { src: '/landing/editor/t3-working.webp', name: 'T3 Code working.png' },
];
const PROMPT = 'Make these a launch film';
// Real Revline MCP tools, in the order an agent builds the film.
const CALLS: { tool: string; detail: string }[] = [
  { tool: 'uploadMedia', detail: 'T3 Code new thread.png' }, { tool: 'uploadMedia', detail: 'T3 Code working.png' },
  { tool: 'addScene', detail: 'Intro title' }, { tool: 'addScene', detail: 'Screenshot parts' }, { tool: 'editScene', detail: 'Matched colors and type' },
  { tool: 'markMusicBeats', detail: '15 beats' }, { tool: 'alignCutsToBeat', detail: '14 clips' }, { tool: 'inspectTimeline', detail: '37.9 s' },
];
const OPENING = 'Breaking each screen into parts. 🫡';
const CLOSING = 'Your launch film is on the timeline: 14 clips, 37.9 seconds, cut to the music. Open it in Revline to watch or tweak it.';

function Attachments({ className }: { className: string }) {
  return <div className={className}>{SCREENSHOTS.map(shot => <img key={shot.src} src={shot.src} alt={shot.name} width={480} height={260} loading="lazy" decoding="async" />)}</div>;
}

/** Claude's chat (claude.ai): user bubble on the right, serif replies, connector tool calls as quiet rows. */
export function ClaudeChat() {
  return <div className="agent-chat agent-chat-claude" aria-label="Claude conversation using Revline">
    <header><span>Launch film from screenshots</span><ChevronDown size={14} aria-hidden="true" /></header>
    <div className="agent-chat-scroll">
      <div className="agent-chat-user"><Attachments className="agent-chat-files" /><p>{PROMPT}</p></div>
      <div className="agent-chat-reply">
        <p>{OPENING}</p>
        <div className="claude-tools">
          <div className="claude-tools-head"><Brand markOnly /><span>Used Revline integration</span><small>{CALLS.length} tools</small><ChevronDown size={14} aria-hidden="true" /></div>
          {CALLS.map((call, index) => <div key={index} className="claude-tool"><span>{call.tool}</span><small>{call.detail}</small></div>)}
        </div>
        <p>{CLOSING}</p>
        <ClaudeLogo className="claude-spark" width={22} height={22} />
      </div>
    </div>
    <div className="agent-chat-composer" aria-hidden="true">
      <span>Reply to Claude…</span>
      <div><span className="claude-composer-icons"><Plus size={16} /><SlidersHorizontal size={15} /></span><span className="claude-model">Opus 5.5<ChevronDown size={12} /></span><i><ArrowUp size={15} /></i></div>
    </div>
  </div>;
}

/** ChatGPT's chat (chatgpt.com, developer mode): grey user bubble, plain replies, "Called tool" rows for the app. */
export function ChatGPTChat() {
  return <div className="agent-chat agent-chat-chatgpt" aria-label="ChatGPT conversation using Revline">
    <header><span>ChatGPT</span><ChevronDown size={14} aria-hidden="true" /></header>
    <div className="agent-chat-scroll">
      <div className="agent-chat-user"><Attachments className="agent-chat-files" /><p>{PROMPT}</p></div>
      <div className="agent-chat-reply">
        <p>{OPENING}</p>
        <div className="chatgpt-tools">
          {CALLS.map((call, index) => <div key={index} className="chatgpt-tool"><Brand markOnly /><span>Called <b>Revline</b> · {call.tool}</span><ChevronRight size={13} aria-hidden="true" /></div>)}
        </div>
        <p>{CLOSING}</p>
      </div>
    </div>
    <div className="agent-chat-composer" aria-hidden="true">
      <div><Plus size={18} /><span>Ask anything</span><span className="chatgpt-composer-icons"><Mic size={16} /><i><AudioLines size={15} /></i></span></div>
    </div>
    <p className="chatgpt-footnote" aria-hidden="true"><OpenAILogo width={10} height={10} />ChatGPT can make mistakes. Check important info.</p>
  </div>;
}
