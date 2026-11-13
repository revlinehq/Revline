export type VideoLink = {
  kind: 'youtube' | 'twitch' | 'kick' | 'x' | 'page' | 'file';
  url: string;
  /** Set when the link needs a media processor newer than the first link importer (see GATED_IMPORT_SOURCES). */
  needs?: 'twitch-clips' | 'more-sites';
};

/** One import brings in at most this much video: a whole video up to this long, or a start/end range up to this long. */
export const MAX_IMPORT_SECONDS = 3 * 3600;
/** Twitch ranges up to this long are cut on the exact frame (re-encoded); longer ones are stream-copied from the keyframe before the start, at most about two seconds early. Other sites always cut exactly. */
export const EXACT_IMPORT_CUT_SECONDS = 180;
/** What links import, said the same way in every refusal. */
export const SUPPORTED_LINKS = 'YouTube videos and Shorts, Twitch VODs and clips, Kick recordings, X posts, Dailymotion, Streamable and Loom videos, or a direct link to a video file';
/** The refusal for a non-YouTube link where only YouTube links import (the Add media link field and the Library). */
export const YOUTUBE_ONLY_LINK = 'Paste a link to one YouTube video.';
export const importClock = (seconds: number) => {
  const total = Math.floor(seconds), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
export const importLimitText = `One import brings in at most ${MAX_IMPORT_SECONDS / 3600} hours of video.`;

const MEDIA_FILE = /\.(mp4|mov|m4v|webm|mkv)$/i;
/** Sites yt-dlp reads with a dedicated extractor, limited to one public video page each. */
const PAGE_SITES: { hosts: string[]; path: RegExp; site: string; url: (match: RegExpExecArray) => string }[] = [
  { site: 'Dailymotion', hosts: ['dailymotion.com', 'www.dailymotion.com'], path: /^\/video\/([A-Za-z0-9]+)(?:_[^/]*)?\/?$/, url: m => `https://www.dailymotion.com/video/${m[1]}` },
  { site: 'Dailymotion', hosts: ['dai.ly'], path: /^\/([A-Za-z0-9]+)\/?$/, url: m => `https://www.dailymotion.com/video/${m[1]}` },
  { site: 'Streamable', hosts: ['streamable.com', 'www.streamable.com'], path: /^\/([a-z0-9]+)\/?$/, url: m => `https://streamable.com/${m[1]}` },
  { site: 'Loom', hosts: ['loom.com', 'www.loom.com'], path: /^\/share\/([0-9a-f]+)\/?$/, url: m => `https://www.loom.com/share/${m[1]}` },
];
/** Sites that only serve video to a signed-in viewer or refuse server addresses (checked with yt-dlp 2026.10.26 on 2026-11-11):
 *  a plain refusal instead of a queued download that fails. A direct file on one of them still imports. */
const SIGNED_IN_SITES: Record<string, string> = { 'vimeo.com': 'Vimeo', 'www.vimeo.com': 'Vimeo', 'player.vimeo.com': 'Vimeo', 'tiktok.com': 'TikTok', 'www.tiktok.com': 'TikTok', 'm.tiktok.com': 'TikTok', 'vm.tiktok.com': 'TikTok', 'vt.tiktok.com': 'TikTok', 'rumble.com': 'Rumble', 'www.rumble.com': 'Rumble', 'instagram.com': 'Instagram', 'www.instagram.com': 'Instagram', 'm.instagram.com': 'Instagram', 'facebook.com': 'Facebook', 'www.facebook.com': 'Facebook', 'm.facebook.com': 'Facebook', 'fb.watch': 'Facebook' };

/** Share validation between the form, queue and downloader. DNS is checked by the worker. */
export function parseVideoLink(value: string): VideoLink {
  if (value.length > 2048) throw new Error('This video link is too long.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(`Paste a full video link: ${SUPPORTED_LINKS}.`); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Use a public HTTPS video link without login credentials.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) throw new Error('Use a public video link.');
  url.hash = '';
  if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(host)) {
    const status = /^\/(?:[A-Za-z0-9_]+\/status|i\/status)\/(\d+)\/?$/.exec(url.pathname);
    if (!status) throw new Error('Use a link to one public X video post.');
    return { kind: 'x', url: `https://x.com/i/status/${status[1]}` };
  }
  if (host === 'clips.twitch.tv' || ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(host)) {
    const embedded = host === 'clips.twitch.tv' && /^\/embed\/?$/.test(url.pathname) ? url.searchParams.get('clip') : null;
    const slug = embedded ?? (host === 'clips.twitch.tv' ? /^\/([A-Za-z0-9_-]+)\/?$/ : /^\/(?:[A-Za-z0-9_]+\/)?clip\/([A-Za-z0-9_-]+)\/?$/).exec(url.pathname)?.[1];
    if (slug && slug !== 'embed' && /^[A-Za-z0-9_-]+$/.test(slug)) return { kind: 'twitch', url: `https://clips.twitch.tv/${slug}`, needs: 'twitch-clips' };
    const vod = host === 'clips.twitch.tv' ? null : /^\/(?:[A-Za-z0-9_]+\/v(?:ideo)?|videos)\/(\d+)\/?$/.exec(url.pathname);
    if (!vod) throw new Error('This Twitch link is not a VOD or a clip, and a live channel cannot be imported. Use the broadcast\'s VOD link (twitch.tv/videos/<id>, also while it is still live) with start and end, or a Twitch clip link.');
    return { kind: 'twitch', url: `https://www.twitch.tv/videos/${vod[1]}` };
  }
  if(['kick.com','www.kick.com'].includes(host)) {
    if(!/^\/[\w-]+\/videos\/[\w-]+\/?$/.test(url.pathname)&&!/^\/video\/[\w-]+\/?$/.test(url.pathname))throw new Error('Use a Kick recording link, not a live channel.');
    return {kind:'kick',url:`https://kick.com${url.pathname}`};
  }
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host)) {
    const id = host.endsWith('youtu.be') ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(shorts|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[2];
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) throw new Error('Paste a link to one YouTube video.');
    return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${id}` };
  }
  const sites = PAGE_SITES.filter(site => site.hosts.includes(host));
  for (const site of sites) {
    const match = site.path.exec(url.pathname);
    if (match) return { kind: 'page', url: site.url(match), needs: 'more-sites' };
  }
  // A file served from one of these hosts (player.vimeo.com/…/file.mp4) is still a direct file.
  if (sites.length && !MEDIA_FILE.test(url.pathname)) throw new Error(`Use a link to one public ${sites[0].site} video.`);
  if (SIGNED_IN_SITES[host] && !MEDIA_FILE.test(url.pathname)) throw new Error(`${SIGNED_IN_SITES[host]} videos cannot be imported from a link. Download the video and upload the file instead.`);
  return { kind: 'file', url: url.toString() };
}

/** Loose check for enabling an import button; parseVideoLink gives the real verdict and its message. */
export function looksLikeLink(value: string) {
  return /^https?:\/\/[^\s/]+\.\S+$/i.test(value.trim());
}

/** True when the text is nothing but one video link: a supported site, or a direct media file. */
export function isVideoLinkOnly(value: string) {
  if (/\s/.test(value.trim())) return false;
  try {
    const link = parseVideoLink(value);
    return link.kind !== 'file' || MEDIA_FILE.test(new URL(link.url).pathname);
  } catch { return false; }
}
