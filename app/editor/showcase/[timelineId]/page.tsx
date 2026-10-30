import type { Metadata } from 'next';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { TimelineShowcase } from '@/components/editor/timeline-showcase';
import '@/app/editor.css';

const title = 'Watch the edit. Explore every decision. | Revline';
const description = 'Explore the video, timeline, and shared conversation behind an AI edit. Make your own copy in Revline.';
const image = { url: 'https://tryrevline.com/images/showcase-card.png', width: 1200, height: 630, alt: 'Revline: the edit, timeline, and conversation' };
/** The link preview: the timeline's name, and its card (a frame of it with a play button) once it is rendered. */
export async function generateMetadata({ params }: { params: Promise<{ timelineId: string }> }): Promise<Metadata> {
  const { timelineId } = await params;
  const convex = process.env.NEXT_PUBLIC_CONVEX_URL, site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const card = convex ? await new ConvexHttpClient(convex).query(api.timelineShares.card, { shareId: timelineId }).catch(() => null) : null;
  if (!card) return { title, description, openGraph: { type: 'website', siteName: 'Revline', title, description, images: [image] }, twitter: { card: 'summary_large_image', title, description, images: [image] } };
  const named = `${card.title} | Revline`, made = 'Made with Revline.';
  const cardImage = card.hasImage && site ? { url: `${site}/share-card?share=${encodeURIComponent(timelineId)}&v=${card.updatedAt}`, width: 1200, height: 630, alt: card.title } : image;
  return { title: named, description: made, openGraph: { type: 'video.other', siteName: 'Revline', title: card.title, description: made, images: [cardImage] }, twitter: { card: 'summary_large_image', title: card.title, description: made, images: [cardImage] } };
}
export default async function TimelineShowcasePage({ params }: { params: Promise<{ timelineId: string }> }) {
  const { timelineId } = await params;
  return <TimelineShowcase shareId={timelineId}/>;
}
