import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: 'https://tryrevline.com/' }, { url: 'https://tryrevline.com/pricing' }];
}
