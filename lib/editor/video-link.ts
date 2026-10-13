export type VideoLink = { kind: 'youtube' | 'file'; url: string };

/** Share validation between the form, queue and downloader. DNS is checked by the worker. */
export function parseVideoLink(value: string): VideoLink {
  if (value.length > 2048) throw new Error('This video link is too long.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Paste a full YouTube or MP4 link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Use a public HTTPS video link without login credentials.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) throw new Error('Use a public video link.');
  url.hash = '';
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host)) {
    const id = host.endsWith('youtu.be') ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(shorts|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[2];
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) throw new Error('Paste a link to one YouTube video.');
    return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${id}` };
  }
  return { kind: 'file', url: url.toString() };
}
