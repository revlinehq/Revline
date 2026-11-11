import { EditorRoute } from '@/components/editor/editor-route';
import '@/app/editor.css';

/** proxy.ts sends signed-out visitors to sign-in; the project itself is owner-checked by every Convex read. */
export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <EditorRoute projectId={projectId} />;
}
