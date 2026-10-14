import type { Metadata } from 'next';
import { TimelineShowcase } from '@/components/editor/timeline-showcase';
import '@/app/editor.css';

export const metadata: Metadata = { title: 'Shared timeline — Revline', description: 'Watch the edit, explore its timeline, and make your own copy in Revline.' };
export default async function TimelineShowcasePage({ params }: { params: Promise<{ timelineId: string }> }) {
  const { timelineId } = await params;
  return <TimelineShowcase shareId={timelineId}/>;
}
