import { stockAudio } from '../editor/stock-audio';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';

/** Only immutable, CC0 catalog sounds are public. Arbitrary storage keys never enter this route. */
export async function stockAudioResponse(request: Request, id: string): Promise<Response> {
  const sound = stockAudio(id);
  if (!sound) return new Response('Audio FX sound not found.', { status: 404 });
  const etag = `"${sound.sha256}"`;
  const headers = new Headers({ 'Content-Type': sound.contentType, 'Cache-Control': 'public, max-age=31536000, immutable', 'Accept-Ranges': 'bytes', ETag: etag, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="${sound.name}.ogg"` });
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
  const range = request.method === 'HEAD' || request.headers.has('If-Range') && request.headers.get('If-Range') !== etag ? null : request.headers.get('Range');
  const interval = range?.match(/^bytes=(\d*)-(\d*)$/), start = interval?.[1] ? Number(interval[1]) : 0, end = interval?.[2] ? Number(interval[2]) : sound.size - 1;
  if (range && (!interval || !interval[1] && !interval[2] || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= sound.size || interval[1] && end < start || !interval[1] && end === 0)) {
    headers.set('Content-Range', `bytes */${sound.size}`);return new Response(null, { status: 416, headers });
  }
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return new Response('Audio FX playback is temporarily unavailable.', { status: 503 });
  try {
    const url = await new ConvexHttpClient(convexUrl).action(api.assets.catalogAudioUrl, { catalogId: sound.id });
    const upstream = await fetch(url, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: range ? { Range: range } : undefined, signal: request.signal });
    if (upstream.status !== 200 && upstream.status !== 206) return new Response('Audio FX playback is temporarily unavailable.', { status: upstream.status === 404 ? 404 : 502 });
    headers.set('Content-Length', upstream.headers.get('Content-Length') ?? String(sound.size));
    if (upstream.headers.has('Content-Range')) headers.set('Content-Range', upstream.headers.get('Content-Range')!);
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response('Audio FX playback is temporarily unavailable.', { status: 502 });
  }
}
