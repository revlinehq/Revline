import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClipPrototypeLoader } from '@/components/prototype/clip-prototype-loader';
import '../editor.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Revline', robots: { index: false, follow: false } };

export default function PrototypePage() {
  if (process.env.NODE_ENV !== 'development' && process.env.REVLINE_CLIP_PROTOTYPE !== 'true') notFound();
  return <ClipPrototypeLoader/>;
}
