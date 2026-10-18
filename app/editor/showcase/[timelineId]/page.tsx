import type { Metadata } from 'next';
import { TimelineShowcase } from '@/components/editor/timeline-showcase';
import '@/app/editor.css';

const title = 'Watch the edit. Explore every decision. — Revline';
const description = 'Explore the video, timeline, and shared conversation behind an AI edit. Make your own copy in Revline.';
const image = { url: 'https://tryrevline.com/images/showcase-card.png', width: 1200, height: 630, alt: 'Revline — the edit, timeline, and conversation' };
export const metadata: Metadata = {
  title, description,
  openGraph: { type: 'website', siteName: 'Revline', title, description, images: [image] },
  twitter: { card: 'summary_large_image', title, description, images: [image] },
};
export default async function TimelineShowcasePage({ params }: { params: Promise<{ timelineId: string }> }) {
  const { timelineId } = await params;
  return <TimelineShowcase shareId={timelineId}/>;
}
