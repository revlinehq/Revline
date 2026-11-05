import type { MetadataRoute } from 'next';
import { blogPosts } from '@/lib/blog';
import { marketingPages } from '@/lib/marketing-pages';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://tryrevline.com/' },
    { url: 'https://tryrevline.com/pricing' },
    ...marketingPages.map(page => ({ url: `https://tryrevline.com/${page.slug}` })),
    { url: 'https://tryrevline.com/blog' },
    ...blogPosts.map(post => ({ url: `https://tryrevline.com/blog/${post.slug}`, lastModified: post.updated })),
  ];
}
