import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
export default async function ConversationPage({ params }: { params: Promise<{ projectId: string }> }) {
  await auth.protect();
  const { projectId } = await params;
  redirect(`/editor/${encodeURIComponent(projectId)}`);
}
