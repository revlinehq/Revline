import { createHash } from 'node:crypto';
import { link, mkdir, readdir, rm, stat, statfs, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MIB = 1024 * 1024;
// Budget for the 16 GB processor disk, which also holds the ~5 GB image and an
// export's extracted/captured frames: up to 2 GiB of retained sources, so a
// large source survives between exports, evicted first when free space runs low.
const MAX_BYTES = cacheBudget(process.env.MEDIA_ANALYSIS_CACHE_MAX_MB, 2048) * MIB;
const MAX_ENTRIES = 16;
const TTL_MS = 20 * 60_000;
const MIN_FREE_BYTES = 3 * 1024 * MIB;

function cacheBudget(raw: string | undefined, fallback: number) {
  const value = raw ? Number(raw) : fallback;
  return Number.isInteger(value) && value >= 0 && value <= 16384 ? value : fallback;
}

type SourceIdentity = { _id: string; ownerId?: string; size: number; contentType: string; r2Key?: string; storageId?: string; duration?: number; width?: number; height?: number };
type CachedFileInput = { identity?: string; variant: string; target: string; signal: AbortSignal; expectedBytes?: number; maxBytes?: number };
function cacheLocation(input: Pick<CachedFileInput, 'identity' | 'variant'>) {
  const directory = process.env.MEDIA_ANALYSIS_CACHE_DIR || join(tmpdir(), 'revline-worker-media-v1');
  const key = createHash('sha256').update(JSON.stringify([input.identity, input.variant])).digest('hex');
  return { directory, cached: join(directory, `${key}.cache`) };
}
/** Only fresh, lease-authorized task snapshots supply this identity. Never key on signed URLs. */
export function mediaSourceCacheIdentity(backend: string, projectId: string, source: SourceIdentity): string | undefined {
  if (!source.ownerId || !Number.isSafeInteger(source.size) || source.size <= 0) return undefined;
  return JSON.stringify([new URL(backend).origin, source.ownerId, projectId, source.r2Key ?? source.storageId ?? source._id, source.size, source.contentType, source.duration, source.width, source.height]);
}

async function prune(directory: string, freeSpace = false) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (!item.isFile() || !/^[a-f0-9]{64}\.cache$/.test(item.name)) continue;
    const path = join(directory, item.name), info = await stat(path).catch(() => null);
    if (!info) continue;
    if (Date.now() - info.mtimeMs > TTL_MS) { await rm(path, { force: true }); continue; }
    entries.push({ path, size: info.size, accessed: info.mtimeMs });
  }
  entries.sort((a, b) => a.accessed - b.accessed);
  let bytes = entries.reduce((sum, item) => sum + item.size, 0), count = entries.length;
  for (const entry of entries) {
    const disk = freeSpace ? await statfs(directory) : undefined;
    if (bytes <= MAX_BYTES && count <= MAX_ENTRIES && (!disk || disk.bavail * disk.bsize >= MIN_FREE_BYTES)) break;
    await rm(entry.path, { force: true }); bytes -= entry.size; count--;
  }
}

/** Retain completed immutable files; hard links keep active tasks safe during eviction. */
export async function reuseCachedMediaFile(input: CachedFileInput): Promise<boolean> {
  input.signal.throwIfAborted();
  const limit = Math.min(MAX_BYTES, input.maxBytes ?? MAX_BYTES);
  if (!input.identity || limit <= 0 || (input.expectedBytes !== undefined && input.expectedBytes > limit)) return false;
  const { cached } = cacheLocation(input);
  try {
    const info = await stat(cached);
    if (!info.isFile() || info.size <= 0 || info.size > limit || Date.now() - info.mtimeMs > TTL_MS || (input.expectedBytes !== undefined && info.size !== input.expectedBytes)) return false;
    await link(cached, input.target);
    input.signal.throwIfAborted();
    await utimes(cached, new Date(), new Date()).catch(() => {});
    return true;
  } catch { input.signal.throwIfAborted(); return false; }
}

export async function reuseMediaFile(input: CachedFileInput, produce: () => Promise<unknown>): Promise<boolean> {
  input.signal.throwIfAborted();
  const limit = Math.min(MAX_BYTES, input.maxBytes ?? MAX_BYTES);
  if (!input.identity || limit <= 0 || (input.expectedBytes !== undefined && input.expectedBytes > limit)) { await produce(); return false; }
  const { directory, cached } = cacheLocation(input);
  let available = false;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await prune(directory);
    if (await reuseCachedMediaFile(input)) return true;
    const info = await stat(cached).catch(() => null);
    if (info?.isFile()) await rm(cached, { force: true });
    await prune(directory, true);
    available = true;
  } catch { input.signal.throwIfAborted(); }
  await produce();
  input.signal.throwIfAborted();
  if (!available) return false;
  // Cache failures never turn a successful download/encode into a task retry.
  try {
    const [info, disk] = await Promise.all([stat(input.target), statfs(directory)]);
    if (!info.isFile() || info.size <= 0 || info.size > limit || (input.expectedBytes !== undefined && info.size !== input.expectedBytes) || disk.bavail * disk.bsize < MIN_FREE_BYTES) return false;
    await link(input.target, cached);
    await utimes(cached, new Date(), new Date());
    await prune(directory, true);
  } catch { /* Temporary media caching is optional. */ }
  return false;
}
