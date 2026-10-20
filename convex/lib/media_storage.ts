import { safeDownloadFileName, signMediaToken } from '../../lib/storage/media-tokens';
import type { QueryCtx, MutationCtx, ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export function mediaConfig() {
  const url = process.env.MEDIA_WORKER_URL, secret = process.env.MEDIA_SIGNING_SECRET;
  if (!url || !secret) throw new Error('Cloudflare media storage is not configured');
  return { url: url.replace(/\/$/, ''), secret };
}
export async function mediaUrl(ctx: QueryCtx | MutationCtx | ActionCtx, source: { storageId?: Id<'_storage'>; r2Key?: string }, fresh=false) {
  if (!source.r2Key) return source.storageId ? ctx.storage.getUrl(source.storageId) : null;
  const { url, secret } = mediaConfig();
  // Reactive reads retain stable URLs. Explicit playback recovery must bypass
  // a stalled native range/cache entry rather than reload that exact URL.
  const expires=(fresh?Date.now():Math.floor(Date.now()/86400_000)*86400_000)+7*86400_000;
  const token = await signMediaToken(secret, { operation: 'read', key: source.r2Key, expires });
  return `${url}/read?token=${token}`;
}
export async function mediaDownloadUrl(ctx: QueryCtx | MutationCtx | ActionCtx, source: { storageId?: Id<'_storage'>; r2Key?: string }, fileName: string) {
  const storageUrl = !source.r2Key && source.storageId ? await ctx.storage.getUrl(source.storageId) : null;
  if (!source.r2Key && !storageUrl) return null;
  if (storageUrl) {
    const target = new URL(storageUrl), site = new URL(process.env.CONVEX_SITE_URL ?? '');
    const expectedHost = site.hostname.replace(/\.convex\.site$/, '.convex.cloud');
    if (site.protocol !== 'https:' || !site.hostname.endsWith('.convex.site') || target.protocol !== 'https:' || target.hostname !== expectedHost || target.port || target.username || target.password || !target.pathname.startsWith('/api/storage/')) throw new Error('Export storage origin is invalid');
  }
  const { url, secret } = mediaConfig();
  const token = await signMediaToken(secret, { operation: 'download', expires: Date.now() + 15 * 60_000, fileName: safeDownloadFileName(fileName), ...(source.r2Key ? { key: source.r2Key } : { storageUrl: storageUrl! }) });
  return `${url}/read?token=${token}`;
}
export async function storageControl(body: Record<string, unknown>): Promise<{ uploadId?: string; size?: number; contentType?: string }> {
  const { url, secret } = mediaConfig();
  const token = await signMediaToken(secret, { operation: 'control', expires: Date.now() + 60_000 });
  const response = await fetch(`${url}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Cloudflare media request failed. Please retry.');
  return response.json();
}

export const PREVIEW_VERSION = 1;
export type PreviewSource = { previewR2Key?:string;previewSize?:number;previewWidth?:number;previewHeight?:number;previewFps?:number;previewVersion?:number };
export function hasPreview(source:PreviewSource) {
  return source.previewVersion===PREVIEW_VERSION&&!!source.previewR2Key&&Number.isSafeInteger(source.previewSize)&&source.previewSize!>0&&source.previewSize!<=15_000_000_000&&Number.isInteger(source.previewWidth)&&source.previewWidth!>0&&source.previewWidth!<=16384&&Number.isInteger(source.previewHeight)&&source.previewHeight!>0&&source.previewHeight!<=16384&&Number.isFinite(source.previewFps)&&source.previewFps!>0&&source.previewFps!<=240;
}
export async function previewUrl(ctx:QueryCtx|MutationCtx|ActionCtx,source:PreviewSource,fresh=false) {
  return hasPreview(source)?{previewUrl:await mediaUrl(ctx,{r2Key:source.previewR2Key},fresh)}:{};
}
