import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { blogDate, blogPosts, readingMinutes } from '@/lib/blog';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() { return blogPosts.map(post => ({ slug: post.slug })); }
function findPost(slug: string) { const post = blogPosts.find(item => item.slug === slug); if (!post) notFound(); return post; }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = findPost((await params).slug), title = `${post.title} | Revline`;
  return { title, description: post.description, alternates: { canonical: `/blog/${post.slug}`, types: { 'application/rss+xml': 'https://tryrevline.com/blog/feed.xml' } }, robots: { index: true, follow: true, googleBot: { 'max-image-preview': 'large' } },
    openGraph: { type: 'article', title, description: post.description, url: `/blog/${post.slug}`, publishedTime: post.published, modifiedTime: post.updated, authors: ['https://tryrevline.com/'], images: [{ url: post.image, alt: post.imageAlt }] },
    twitter: { card: 'summary_large_image', title, description: post.description, images: [post.image] } };
}
export default async function Article({ params }: Props) {
  const post = findPost((await params).slug), url = `https://tryrevline.com/blog/${post.slug}`;
  const organization = { '@type': 'Organization', name: 'Revline', url: 'https://tryrevline.com/' };
  const data = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'BlogPosting', '@id': `${url}#article`, mainEntityOfPage: url, headline: post.title, description: post.description, image: `https://tryrevline.com${post.image}`, datePublished: post.published, dateModified: post.updated, author: organization, publisher: { ...organization, logo: { '@type': 'ImageObject', url: 'https://tryrevline.com/brand/revline-square-1024.png' } }, inLanguage: 'en', articleSection: post.category },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Revline', item: 'https://tryrevline.com/' }, { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://tryrevline.com/blog' }, { '@type': 'ListItem', position: 3, name: post.title, item: url }] },
  ] };
  return <article className="landing-section blog-article">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
    <nav aria-label="Breadcrumb" className="blog-breadcrumb"><Link href="/">Revline</Link><span aria-hidden="true">/</span><Link href="/blog">Blog</Link><span aria-hidden="true">/</span><span>{post.category}</span></nav>
    <header><h1>{post.title}</h1><p className="blog-summary">{post.description}</p><p className="blog-meta">By <Link href="/">Revline</Link> · <time dateTime={post.published}>{blogDate(post.published)}</time> · {readingMinutes(post)} min read</p></header>
    <img className="blog-cover" src={post.image} alt={post.imageAlt} width={1920} height={1080} fetchPriority="high"/>
    <div className="blog-body">{post.sections.map(section => <section key={section.heading}><h2>{section.heading}</h2>{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</section>)}<p className="blog-disclosure">Prepared with AI assistance from Revline’s editing workflows.</p></div>
    <aside className="blog-next"><h2>Try it on your next edit.</h2><p>Bring your footage and describe what you want to change.</p><div><Button asChild className="blog-primary"><Link href={NEW_PROJECT_PATH}>Start editing</Link></Button><Button asChild variant="outline"><Link href={post.featurePath}>Explore the workflow</Link></Button></div></aside>
    <nav className="blog-related" aria-label="More guides"><h2>Keep reading</h2>{blogPosts.filter(item => item.slug !== post.slug).map(item => <Link key={item.slug} href={`/blog/${item.slug}`}>{item.title} ↗</Link>)}</nav>
  </article>;
}
