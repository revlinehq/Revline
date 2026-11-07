import { attachmentDisposition, safeDownloadFileName, verifyMediaToken } from '../../lib/storage/media-tokens';
import { MAX_UPLOAD_PART_BYTES, MAX_UPLOAD_PARTS } from '../../lib/storage/upload-parts';

function validKey(key: unknown): key is string {
  return typeof key === 'string' && /^media\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9-]+$/.test(key);
}
function hasBody(object: R2Object): object is R2ObjectBody { return 'body' in object; }
function json(value: unknown, status = 200) { return Response.json(value, { status }); }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const path = new URL(request.url).pathname;
    const diagnostic = (reason: string, status: number, error?: unknown) => console.warn('[media-storage]', {
      route: ['/part', '/read', '/control', '/cache'].includes(path) ? path : '/other', method: request.method, status, reason,
      ...(error instanceof Error ? { errorType: error.name } : {}),
      // Never persist signed URLs, authorization headers, media keys or filenames.
    });
    const allowed = env.ALLOWED_ORIGINS.split(',');
    if (origin && !allowed.includes(origin)) { diagnostic('origin-not-allowed', 403); return json({ error: 'Origin is not allowed' }, 403); }
    const cors = new Headers({ 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, HEAD, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Range', 'Access-Control-Expose-Headers': 'ETag, Content-Range, Content-Length, Accept-Ranges, Content-Disposition', ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const token = url.pathname === '/control' ? request.headers.get('Authorization')?.replace(/^Bearer /, '') : url.searchParams.get('token');
    const grant = token ? await verifyMediaToken(env.MEDIA_SIGNING_SECRET, token) : null;
    const reply = (value: unknown, status: number) => { if (status >= 400) diagnostic('request-rejected', status); const response = json(value, status); for (const [name, value] of cors) response.headers.set(name, value); return response; };
    if (!grant) return reply({ error: 'Media access has expired' }, 401);
    const borrowed = 'READ_ONLY_MEDIA_KEYS' in env && typeof env.READ_ONLY_MEDIA_KEYS === 'string' ? JSON.parse(env.READ_ONLY_MEDIA_KEYS) as string[] : [];
    if (grant.key && !['GET', 'HEAD'].includes(request.method) && borrowed.includes(grant.key)) return reply({ error: 'Borrowed development media is read-only' }, 403);
    const download = grant.operation === 'download';
    if (download && (typeof grant.fileName !== 'string' || grant.fileName !== safeDownloadFileName(grant.fileName))) return reply({ error: 'Invalid download grant' }, 403);
    let response: Response;
    try {
      if (url.pathname === '/cache' && request.method === 'PUT' && grant.operation === 'cacheWrite' && validKey(grant.key) && /\/cache-[a-f0-9-]+$/.test(grant.key) && request.body) {
        const size = Number(request.headers.get('Content-Length'));
        if (!Number.isSafeInteger(size) || size < 1 || size > 64 * 1024 * 1024) return reply({ error: 'Invalid cache object size' }, 400);
        const contentType = request.headers.get('Content-Type');
        if (!contentType || !['image/png', 'application/json', 'application/octet-stream'].includes(contentType)) return reply({ error: 'Invalid cache content type' }, 400);
        await env.MEDIA.put(grant.key, request.body, { httpMetadata: { contentType } });
        response = json({ ok: true });
      } else if (url.pathname === '/part' && request.method === 'PUT' && grant.operation === 'part' && validKey(grant.key) && grant.uploadId && Number.isInteger(grant.partNumber) && grant.partNumber! > 0 && grant.partNumber! <= MAX_UPLOAD_PARTS && grant.size && request.body) {
        // Upload bodies stream straight to R2; no whole-file buffering in the Worker.
        if (Number(request.headers.get('Content-Length')) !== grant.size || grant.size > MAX_UPLOAD_PART_BYTES) return reply({ error: 'Upload part size does not match' }, 400);
        const upload = env.MEDIA.resumeMultipartUpload(grant.key, grant.uploadId);
        response = json(await upload.uploadPart(grant.partNumber!, request.body));
      } else if (url.pathname === '/read' && (request.method === 'GET' || request.method === 'HEAD') && download && grant.storageUrl && !grant.key) {
        // Only a server-signed legacy source can be proxied. Never accept a URL
        // or attachment filename from the request's unsigned query parameters.
        const source = new URL(grant.storageUrl);
        if (source.protocol !== 'https:' || !source.hostname.endsWith('.convex.cloud') || source.port || source.username || source.password || !source.pathname.startsWith('/api/storage/')) return reply({ error: 'Invalid export source' }, 403);
        const forwarded = new Headers();
        for (const name of ['Range', 'If-None-Match', 'If-Modified-Since']) {
          const value = request.headers.get(name); if (value) forwarded.set(name, value);
        }
        const upstream = await fetch(source, { method: request.method, headers: forwarded, redirect: 'error', signal: request.signal });
        if (![200, 206, 304].includes(upstream.status)) {
          await upstream.body?.cancel();
          return reply({ error: 'Export file could not be downloaded' }, upstream.status === 404 ? 404 : 502);
        }
        const headers = new Headers({ 'Content-Disposition': attachmentDisposition(grant.fileName!), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
          const value = upstream.headers.get(name); if (value) headers.set(name, value);
        }
        response = new Response(upstream.body, { status: upstream.status, headers });
      } else if (url.pathname === '/read' && (request.method === 'GET' || request.method === 'HEAD') && (grant.operation === 'read' || download) && validKey(grant.key) && !grant.storageUrl) {
        const readStarted=Date.now();
        const object = request.method === 'HEAD' ? await env.MEDIA.head(grant.key) : await env.MEDIA.get(grant.key, { range: request.headers, onlyIf: request.headers });
        if (!object) response = json({ error: 'Media not found' }, 404);
        else {
          const headers = new Headers({ 'Accept-Ranges': 'bytes', 'ETag': object.httpEtag, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
          object.writeHttpMetadata(headers);
          if (download) {
            headers.set('Content-Disposition', attachmentDisposition(grant.fileName!));
            headers.set('Cache-Control', 'private, no-store');
          }
          if (request.method === 'GET' && !hasBody(object)) response = new Response(null, { status: 304, headers });
          else {
            const range = request.method === 'GET' && request.headers.has('Range') ? object.range : undefined;
            const offset = range && 'offset' in range ? range.offset ?? 0 : 0;
            const length = range && 'length' in range ? range.length ?? object.size : object.size;
            headers.set('Content-Length', String(length));
            if (range) headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
            console.info('[media-storage read]',{method:request.method,status:range?206:200,offset,length,size:object.size,metadataMs:Date.now()-readStarted,ray:request.headers.get('cf-ray')});
            response = new Response(hasBody(object) ? object.body : null, { status: range ? 206 : 200, headers });
          }
        }
      } else if (url.pathname === '/control' && request.method === 'POST' && grant.operation === 'control') {
        if (Number(request.headers.get('Content-Length')) > 1_000_000) return reply({ error: 'Request is too large' }, 413);
        const body = await request.json() as { action: string; key: string; contentType?: string; uploadId?: string; parts?: R2UploadedPart[] };
        if (!validKey(body.key)) return reply({ error: 'Invalid media key' }, 400);
        if (borrowed.includes(body.key)) return reply({ error: 'Borrowed development media is read-only' }, 403);
        if (body.action === 'create' && body.contentType && /^(video|audio|image)\//.test(body.contentType)) {
          const upload = await env.MEDIA.createMultipartUpload(body.key, { httpMetadata: { contentType: body.contentType } });
          response = json({ uploadId: upload.uploadId });
        } else if (body.action === 'complete' && body.uploadId && body.parts?.length && body.parts.length <= 10000) {
          const parts = body.parts;
          if (parts.some((part, index) => part.partNumber !== index + 1 || typeof part.etag !== 'string' || part.etag.length > 256)) return reply({ error: 'Invalid upload parts' }, 400);
          // A retry after a lost completion response can reuse the completed object.
          const existing = await env.MEDIA.head(body.key);
          if (!existing) await env.MEDIA.resumeMultipartUpload(body.key, body.uploadId).complete(parts);
          // R2's completion response omits HTTP metadata; head returns persisted metadata.
          const object = existing ?? await env.MEDIA.head(body.key);
          if (!object) return reply({ error: 'Completed media could not be read' }, 502);
          response = json({ size: object.size, contentType: object.httpMetadata?.contentType, etag: object.etag });
        } else if (body.action === 'abort' && body.uploadId) {
          if (!await env.MEDIA.head(body.key)) await env.MEDIA.resumeMultipartUpload(body.key, body.uploadId).abort();
          response = json({ ok: true });
        } else if (body.action === 'delete') {
          await env.MEDIA.delete(body.key); response = json({ ok: true });
        } else response = json({ error: 'Invalid storage operation' }, 400);
      } else response = json({ error: 'Media operation is not allowed' }, 403);
    } catch (error) {
      diagnostic('storage-operation-failed', 502, error);
      response = json({ error: 'Cloudflare could not complete this media request. Please retry.' }, 502);
    }
    for (const [name, value] of cors) response.headers.set(name, value);
    return response;
  },
} satisfies ExportedHandler<Env>;
