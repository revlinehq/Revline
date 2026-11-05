import type { MetadataRoute } from 'next';
import { marketingPages } from '@/lib/marketing-pages';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: 'https://tryrevline.com/' }, { url: 'https://tryrevline.com/pricing' }, ...marketingPages.map(page => ({ url: `https://tryrevline.com/${page.slug}` }))];
}
