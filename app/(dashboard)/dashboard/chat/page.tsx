import type { Metadata } from 'next';
import { NEW_WORKSPACE_LABEL } from '@/lib/editor/workspace-labels';
import { NewConversation } from '@/components/workspace/new-conversation';
import { EditorAccessGate } from '@/components/workspace/editor-access-gate';

export const metadata: Metadata = { title: `${NEW_WORKSPACE_LABEL} — Revline` };

export default function NewChatPage() { return <EditorAccessGate><NewConversation /></EditorAccessGate>; }
