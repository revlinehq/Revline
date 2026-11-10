import { Facebook, Instagram, Youtube } from 'lucide-react';

const NAMES: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', x: 'X', twitter: 'X', facebook: 'Facebook' };
/** The platform's display name; an unknown platform keeps the name the campaign gave it. */
export const platformName = (platform: string) => NAMES[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);

const ORDER = ['tiktok', 'instagram', 'youtube', 'x', 'twitter', 'facebook'];
/** Platforms in the order the dashboard always lists them; ones it does not know go last, as given. */
export function orderedPlatforms(platforms: readonly string[]) {
  const rank = (platform: string) => { const index = ORDER.indexOf(platform); return index < 0 ? ORDER.length : index; };
  return [...platforms].sort((a, b) => rank(a) - rank(b));
}

/** A small platform mark. Platforms without a mark render nothing. */
export function PlatformIcon({ platform, size = 14 }: { platform: string; size?: number }) {
  const label = platformName(platform);
  if (platform === 'instagram') return <Instagram size={size} aria-label={label} />;
  if (platform === 'youtube') return <Youtube size={size} aria-label={label} />;
  if (platform === 'facebook') return <Facebook size={size} aria-label={label} />;
  if (platform === 'tiktok') return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={label}><path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" /></svg>;
  if (platform === 'x' || platform === 'twitter') return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={label}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;
  return null;
}
