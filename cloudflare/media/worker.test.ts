import { expect, test, vi } from 'vitest';
import worker from './worker';
import { signMediaToken } from '../../lib/storage/media-tokens';
const secret = 'fixture-signing-secret';
const key = 'media/owner/project/fixture';
const object = { size: 1024, etag: 'fixture-etag', httpEtag: '"fixture-etag"', range: { offset: 0, length: 1024 }, httpMetadata: { contentType: 'video/mp4' }, writeHttpMetadata: (headers: Headers) => headers.set('Content-Type', 'video/mp4') };
async function request(path: string, operation: 'read' | 'control', init?: RequestInit) {
 const token = await signMediaToken(secret, { operation, key, expires: Date.now() + 60000 });
 return new Request(`https://media.example/${path}${operation === 'read' ? `?token=${token}` : ''}`, { ...init, headers: { ...init?.headers, ...(operation === 'control' ? { Authorization: `Bearer ${token}` } : {}) } }) as Parameters<typeof worker.fetch>[0];
}
function env(media: object) { return { MEDIA: media, MEDIA_SIGNING_SECRET: secret, ALLOWED_ORIGINS: 'http://localhost:3001' } as unknown as Env; }
test('multipart completion returns persisted content type even when completion omits it', async () => {
 const complete = vi.fn().mockResolvedValue({ size: 1024, etag: 'fixture-etag' });
 const head = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(object);
 const response = await worker.fetch(await request('control', 'control', { method: 'POST', body: JSON.stringify({ action: 'complete', key, uploadId: 'fixture', parts: [{ partNumber: 1, etag: 'part-etag' }] }) }), env({ head, resumeMultipartUpload: () => ({ complete }) }));
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({ size: 1024, contentType: 'video/mp4' });
 expect(complete).toHaveBeenCalledOnce();
});
test('full-file HEAD uses 200 and does not emit Content-Range', async () => {
 const response = await worker.fetch(await request('read', 'read', { method: 'HEAD' }), env({ head: async () => object }));
 expect(response.status).toBe(200);
 expect(response.headers.get('Content-Length')).toBe('1024');
 expect(response.headers.get('Content-Range')).toBeNull();
});
test('invalid access is denied before touching R2', async () => {
 const head = vi.fn();
 const response = await worker.fetch(new Request('https://media.example/read?token=forged') as Parameters<typeof worker.fetch>[0], env({ head }));
 expect(response.status).toBe(401);
 expect(head).not.toHaveBeenCalled();
});
test('abort after a completed upload is safe to retry', async () => {
 const abort = vi.fn();
 const response = await worker.fetch(await request('control', 'control', { method: 'POST', body: JSON.stringify({ action: 'abort', key, uploadId: 'fixture' }) }), env({ head: async () => object, resumeMultipartUpload: () => ({ abort }) }));
 expect(response.status).toBe(200);
 expect(abort).not.toHaveBeenCalled();
});
