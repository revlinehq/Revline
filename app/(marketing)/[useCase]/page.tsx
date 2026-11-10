import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LandingNav } from '@/components/landing/nav';
import { LandingFooter } from '@/components/landing/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { marketingPages } from '@/lib/marketing-pages';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import '../../landing.css';
import './use-case.css';

type Props = { params: Promise<{ useCase: string }> };
export const dynamicParams = false;
export function generateStaticParams() { return marketingPages.map(page => ({ useCase: page.slug })); }
function findPage(slug: string) { const page = marketingPages.find(item => item.slug === slug); if (!page) notFound(); return page; }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findPage((await params).useCase);
  const title = `${page.title} | Revline`;
  return { title, description: page.description, alternates: { canonical: `/${page.slug}` },
    openGraph: { title, description: page.description, url: `/${page.slug}`, type: 'website', images: ['/og-revline-v4.png'] },
    twitter: { card: 'summary_large_image', title, description: page.description, images: ['/og-revline-v4.png'] } };
}
export default async function UseCasePage({ params }: Props) {
  const page = findPage((await params).useCase);
  return <main className="landing use-case-page">
    <LandingNav />
    <section className="landing-section use-case-hero">
      <Link href="/" className="use-case-back">Revline / {page.title}</Link>
      <h1>{page.heading}</h1><p>{page.intro}</p>
      <div className="use-case-actions"><Button asChild className="use-case-primary"><Link href={NEW_PROJECT_PATH}>Start editing</Link></Button><Button asChild variant="outline"><Link href="/pricing">See pricing</Link></Button></div>
    </section>
    <section className="landing-section use-case-workflow" aria-labelledby="workflow-title">
      <h2 id="workflow-title">From source to finished edit</h2>
      <div className="use-case-steps">{page.steps.map((step, index) => <Card key={step.title}><CardHeader><span className="use-case-number">0{index + 1}</span><CardTitle>{step.title}</CardTitle></CardHeader><CardContent><p>{step.text}</p></CardContent></Card>)}</div>
    </section>
    <section className="landing-section use-case-prompt" aria-labelledby="prompt-title"><h2 id="prompt-title">Start with a request like this</h2><blockquote>{page.prompt}</blockquote><p>{page.note}</p></section>
    <section className="landing-section use-case-related" aria-labelledby="related-title"><h2 id="related-title">More ways to edit with Revline</h2><ul>{marketingPages.filter(item => item.slug !== page.slug).map(item => <li key={item.slug}><Link href={`/${item.slug}`}>{item.title} <span aria-hidden="true">↗</span></Link></li>)}</ul></section>
    <LandingFooter />
  </main>;
}
