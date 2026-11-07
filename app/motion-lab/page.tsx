import { notFound } from 'next/navigation';
import { MotionLab } from '@/components/dev/motion-lab';

export const metadata = { title: 'Motion lab · Revline', robots: { index: false, follow: false } };

export default function MotionLabPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <MotionLab />;
}
