import { blogPosts } from '@/lib/blog';

export const dynamic = 'force-static';
const xml = (value: string) => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] ?? char);
export function GET() {
  const items = blogPosts.map(post => {
    const url = `https://tryrevline.com/blog/${post.slug}`;
    return `<item><title>${xml(post.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><description>${xml(post.description)}</description><pubDate>${new Date(post.published).toUTCString()}</pubDate><category>${xml(post.category)}</category></item>`;
  }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Revline Blog</title><link>https://tryrevline.com/blog</link><description>Practical video editing guides from Revline.</description><language>en</language><atom:link href="https://tryrevline.com/blog/feed.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
