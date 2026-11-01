import { z } from 'zod';
import { internal } from './_generated/api';
import { httpAction, type ActionCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { mediaConfig } from './lib/media_storage';
import { openUpload, signPartUrl } from './r2';
import { signMediaToken, verifyMediaToken } from '../lib/storage/media-tokens';
import { localUploadScript } from '../lib/storage/local-upload-script';

const metadataInput = z.object({ size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), width: z.number().int().min(1).max(16384).optional(), height: z.number().int().min(1).max(16384).optional(), duration: z.number().positive().optional() }).strict();
const uploadScope = z.object({ ownerId: z.string().min(1), projectId: z.string().min(1), fileName: z.string().trim().min(1).max(255), contentType: z.string().regex(/^(video|image|audio)\/[\w.+-]+$/) });
type UploadScope = z.infer<typeof uploadScope>;
function mediaKind(contentType: string) {
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  throw new Error('Choose a video, image or audio file.');
}

/** No bytes pass through Convex. Only the small probed metadata reaches this scoped endpoint. */
async function prepareLocalUpload(ctx: ActionCtx, scope: UploadScope, metadata: z.infer<typeof metadataInput>) {
  const kind = mediaKind(scope.contentType);
  if (kind !== 'image' && !metadata.duration) throw new Error('This media has no readable duration.');
  const upload = await openUpload(ctx, { projectId: scope.projectId as Id<'projects'>, fileName: scope.fileName, contentType: scope.contentType, kind, ...metadata }, scope.ownerId);
  const lease = await ctx.runQuery(internal.r2.getLease, { uploadId: upload.uploadId, ownerId: scope.ownerId });
  const urls = await Promise.all(Array.from({ length: upload.partCount }, (_, index) => signPartUrl(lease, index + 1)));
  return { ...upload, urls };
}

export async function startLocalUpload(ctx: ActionCtx, scope: UploadScope, filePath: string) {
  const kind = mediaKind(scope.contentType), projectId = scope.projectId as Id<'projects'>;
  await ctx.runQuery(internal.r2.authorize, { ownerId: scope.ownerId, projectId, kind, contentType: scope.contentType });
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new Error('Upload endpoint is not configured.');
  const { secret } = mediaConfig();
  const token = await signMediaToken(secret, { operation: 'prepareUpload', upload: scope, expires: Date.now() + 3600_000 });
  return { script: localUploadScript({ filePath, kind, endpoint: `${site}/mcp/upload`, token }), next: 'Run this script with sh (Node 22+ and ffprobe must be installed). It reads size, dimensions and duration, uploads the file, and prints JSON. Pass that whole JSON object as the arguments to finishUpload. The script expires in one hour.' };
}

export const prepare = httpAction(async (ctx, request) => {
  const { secret } = mediaConfig();
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const grant = await verifyMediaToken(secret, token);
  const scope = uploadScope.safeParse(grant?.upload);
  if (grant?.operation !== 'prepareUpload' || !scope.success) return Response.json({ error: 'Upload access expired. Call uploadMedia again.' }, { status: 401 });
  const text = await request.text();
  if (text.length > 4096) return Response.json({ error: 'Upload metadata is too large.' }, { status: 413 });
  try {
    const metadata = metadataInput.parse(JSON.parse(text));
    return Response.json(await prepareLocalUpload(ctx, scope.data, metadata), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 1000) : 'Could not prepare this upload.' }, { status: 400 });
  }
});
