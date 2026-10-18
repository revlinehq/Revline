import { v } from 'convex/values';

export const alertSource = v.union(v.literal('clerk'), v.literal('stripe'), v.literal('sentry'), v.literal('posthog'));
export const alertFields = {
  source: alertSource, eventId: v.string(), title: v.string(), description: v.string(),
};

// Only a server-managed Discord incoming webhook may be used as a destination.
export function discordWebhookUrl() {
  if (process.env.DISCORD_ALERTS_ENABLED !== 'true') return null;
  const value = process.env.DISCORD_WEBHOOK_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)) return null;
    url.search = '?wait=true';
    url.hash = '';
    return url.toString();
  } catch { return null; }
}

export function alertText(value: unknown, length = 500) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, length) : '';
}
