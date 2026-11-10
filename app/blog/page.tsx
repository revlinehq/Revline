import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { blogDate, blogPosts, readingMinutes } from '@/lib/blog';

const title = 'Video editing guides | Revline Blog';
const description = 'Practical guides to podcast clips and readable captions, with workflows you can try in Revline.';
export const metadata: Metadata = {
  title, description, alternates: { canonical: '/blog', types: { 'application/rss+xml': 'https://tryrevline.com/blog/feed.xml' } },
  openGraph: { title, description, url: '/blog', type: 'website', images: ['/og-revline-v4.png'] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og-revline-v4.png'] },
};
export default function Blog() {
  return <>
    <header className="landing-section blog-intro"><h1>A better next edit.</h1><p>Practical notes on clipping and captions. Small details that make the finished video work.</p></header>
    <section className="landing-section blog-grid" aria-label="Editing guides">{blogPosts.map(post => <Card key={post.slug} className="blog-card"><Link href={`/blog/${post.slug}`} className="blog-card-link"><img src={post.image} alt={post.imageAlt} width={1920} height={1080} loading="lazy"/><CardHeader><CardTitle><h2>{post.title}</h2></CardTitle><p className="blog-meta"><time dateTime={post.published}>{blogDate(post.published)}</time> · {readingMinutes(post)} min read</p></CardHeader><CardContent><p>{post.description}</p><span className="blog-read">Read the guide ↗</span></CardContent></Link></Card>)}</section>
  </>;
}
