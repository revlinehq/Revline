import type { Metadata } from 'next';
import { NewConversation } from '@/components/workspace/new-conversation';
import { EditorAccessGate } from '@/components/workspace/editor-access-gate';

export const metadata: Metadata = { title: 'New chat — Revline' };

export default function NewChatPage() { return <EditorAccessGate><NewConversation /></EditorAccessGate>; }
