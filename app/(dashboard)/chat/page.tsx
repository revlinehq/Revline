import type { Metadata } from 'next';
import { NewConversation } from '@/components/workspace/new-conversation';

export const metadata: Metadata = { title: 'New chat — Revline' };

export default function NewChatPage() { return <NewConversation />; }
