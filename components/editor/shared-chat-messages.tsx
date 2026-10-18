import type { SharedChatMessage } from '@/lib/editor/shared-chat';

export function SharedChatMessages({ messages }: { messages: SharedChatMessage[] }) {
  return <ol className="shared-chat-messages">{messages.map((message, index) => <li key={index} data-role={message.role}><strong>{message.role === 'user' ? 'Creator' : 'Revline'}</strong><p>{message.text}</p></li>)}</ol>;
}
