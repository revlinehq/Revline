import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/editor/', '/dashboard/', '/chats', '/chat/', '/projects/', '/storage', '/library', '/profile', '/billing', '/mobile/', '/sign-in', '/sign-up', '/sso-callback', '/oauth/'] },
    sitemap: 'https://tryrevline.com/sitemap.xml',
  };
}
