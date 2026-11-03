import { MEDIA_PROCESSOR_VERSION } from './processor-version';

/** Stable across property order and signed URLs. Undefined fields never affect output. */
export function cacheJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => cacheJson(item ?? null)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${cacheJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function cacheHash(value: unknown) {
  const bytes = new TextEncoder().encode(cacheJson(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export type CacheScope = { ownerId: string; projectId: string; assetId?: string; source?: unknown };
export const frameCacheKey = (scope: CacheScope, output: unknown) => cacheHash({ version: MEDIA_PROCESSOR_VERSION, ...scope, output });

/** Keep request and worker descriptors identical; never include request IDs or expiring URLs. */
export function referenceResultDescriptor(work: Record<string, unknown>) {
  const fields = ['mode', 'comparisonIdentity', 'start', 'end', 'times', 'compareCrop', 'referenceCropKeyframes', 'count', 'fps', 'momentsOnly', 'crop', 'box', 'points', 'lines', 'color', 'tolerance', 'text', 'categories'];
  return { kind: 'reference-result', ...Object.fromEntries(fields.filter(key => work[key] !== undefined && !(key === 'momentsOnly' && work[key] === false)).map(key => [key, work[key]])) };
}
export const snapshotResultDescriptor = (identity: string, times: number[]) => ({ kind: 'snapshot-result', identity, times });
export function referenceCacheScope(ownerId: string, projectId: string, asset: { _id: string; r2Key?: string; storageId?: string; size: number; width?: number; height?: number; duration?: number; contentType: string }): CacheScope {
  return { ownerId, projectId, assetId: asset._id, source: [asset.r2Key ?? asset.storageId ?? asset._id, asset.size, asset.width, asset.height, asset.duration, asset.contentType] };
}
