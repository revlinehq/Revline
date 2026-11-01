import type { Metadata } from 'next';
import { SharinganRedirect } from './redirect';

const title = 'Introducing: Revline Sharingan';
const description = 'AI editor that reverse engineers any video';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/sharingan' },
  openGraph: {
    type: 'website',
    url: '/sharingan',
    siteName: 'Revline',
    title,
    description,
    images: [{ url: '/og-sharingan-v1.png', width: 1200, height: 630, alt: `${title}. ${description}` }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [{ url: '/og-sharingan-v1.png', alt: `${title}. ${description}` }],
  },
};

export default function SharinganPage() {
  return <SharinganRedirect />;
}
