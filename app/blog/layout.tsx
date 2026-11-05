import type { ReactNode } from 'react';
import { LandingNav } from '@/components/landing/nav';
import { LandingFooter } from '@/components/landing/footer';
import '../landing.css';
import './blog.css';

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <main className="landing blog-page"><LandingNav />{children}<LandingFooter /></main>;
}
