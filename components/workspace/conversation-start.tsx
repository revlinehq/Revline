import type { ReactNode } from 'react';

/** Shared dashboard composition; callers supply their own data and actions. */
export function ConversationStart({ children, guidance }: { children: ReactNode; guidance?: ReactNode }) {
  return <main className="new-conversation-main" aria-labelledby="new-conversation-title">
    <div className="new-conversation-start"><div className="new-conversation-compose-group">
      <div className="new-conversation-intro"><h1 id="new-conversation-title" title="What are we making today?">What are we making today?</h1></div>
      {children}
      <div className="new-conversation-guidance">{guidance}</div>
    </div></div>
  </main>;
}
