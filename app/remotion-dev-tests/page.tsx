import { notFound } from 'next/navigation';
import { RemotionDevTests } from '@/components/dev/remotion-dev-tests';

export const metadata = { title: 'Remotion lab · Revline', robots: { index: false, follow: false } };

export default function RemotionDevTestsPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <RemotionDevTests />;
}
