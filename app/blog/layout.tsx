import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { marketingPages } from '@/lib/marketing-pages';
import { LandingNav } from '@/components/landing/nav';
import { LandingFooter } from '@/components/landing/footer';
import '../landing.css';
import './blog.css';

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <main className="landing blog-page"><LandingNav /><nav className="blog-workflows" aria-label="Blog navigation"><Button asChild variant="ghost" size="sm"><Link href="/blog">All articles</Link></Button>{marketingPages.map(page => <Button asChild variant="ghost" size="sm" key={page.slug}><Link href={`/${page.slug}`}>{page.navigationLabel}</Link></Button>)}</nav>{children}<LandingFooter /></main>;
}
