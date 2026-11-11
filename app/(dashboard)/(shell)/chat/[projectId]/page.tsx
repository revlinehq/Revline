import { EditorRoute } from '@/components/editor/editor-route';
import '@/app/editor.css';

/** The AI Editor's conversation view of one project: its chat in the shell, with finished clips playable in place. */
export default async function ConversationPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <EditorRoute projectId={projectId} view="chat" />;
}
