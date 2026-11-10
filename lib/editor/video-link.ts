export type VideoLink = { kind: 'youtube' | 'twitch' | 'kick' | 'x' | 'file'; url: string };

/** Share validation between the form, queue and downloader. DNS is checked by the worker. */
export function parseVideoLink(value: string): VideoLink {
  if (value.length > 2048) throw new Error('This video link is too long.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Paste a full YouTube or MP4 link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Use a public HTTPS video link without login credentials.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) throw new Error('Use a public video link.');
  url.hash = '';
  if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(host)) {
    const status = /^\/(?:[A-Za-z0-9_]+\/status|i\/status)\/(\d+)\/?$/.exec(url.pathname);
    if (!status) throw new Error('Use a link to one public X video post.');
    return { kind: 'x', url: `https://x.com/i/status/${status[1]}` };
  }
  if(['twitch.tv','www.twitch.tv'].includes(host)) {
    if(!/^\/videos\/\d+\/?$/.test(url.pathname))throw new Error('Use a Twitch VOD link, not a live channel.');
    return {kind:'twitch',url:`https://www.twitch.tv${url.pathname}`};
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
    return link.kind !== 'file' || /\.(mp4|mov|m4v|webm|mkv)$/i.test(new URL(link.url).pathname);
  } catch { return false; }
}
