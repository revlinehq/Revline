import { auth } from '@clerk/nextjs/server';
import { ConnectedEditor } from '@/components/editor/connected-editor';
import '@/app/editor.css';

/** The AI Editor's conversation view of one project: its chat in the shell, with finished clips playable in place. */
export default async function ConversationPage({ params }: { params: Promise<{ projectId: string }> }) {
  await auth.protect();
  const { projectId } = await params;
  return <ConnectedEditor key={projectId} projectId={projectId} view="chat" />;
}
