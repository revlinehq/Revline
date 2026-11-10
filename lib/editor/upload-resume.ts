import { ConvexError } from 'convex/values';
import type { PartLink } from '../storage/part-links';
import { UploadInterruptedError, uploadMultipart, type StoredPart, type UploadActivity, type UploadedPart } from './multipart-upload';

// What this browser remembers of an unfinished upload, so choosing the same file again
// continues it. The server decides which of these parts count (see `resume` in convex/r2.ts).
type ResumeRecord = { uploadId: string; name: string; size: number; lastModified: number; partSize: number; expiresAt: number; parts: StoredPart[] };
/** An interrupted upload the user can continue by adding the same file again. */
export type UnfinishedUpload = { name: string; size: number; percent: number };

const SAMPLE_BYTES = 2 * 1024 * 1024;
const changed = 'revline-upload-resume';
// IndexedDB, not localStorage: Chrome batches localStorage writes for up to a minute, so a
// crashed or killed browser would forget most of the parts it had stored.
const databaseName = 'revline-uploads', storeName = 'resume';

/** Identifies a file by its size and the first and last 2 MiB; hashing gigabytes would take minutes. */
async function fingerprint(file: File): Promise<string | null> {
  try {
    const edges = file.size <= SAMPLE_BYTES * 2 ? [file] : [file.slice(0, SAMPLE_BYTES), file.slice(file.size - SAMPLE_BYTES)];
    const bytes = await new Blob([...edges, String(file.size)]).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).subarray(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

let opening: Promise<IDBDatabase> | null = null;
function database() {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(storeName); };
    request.onsuccess = () => { request.result.onclose = request.result.onversionchange = () => { request.result.close(); opening = null; }; resolve(request.result); };
    request.onerror = request.onblocked = () => { opening = null; reject(request.error ?? new Error('Browser storage is unavailable.')); };
  });
}
/** Runs one request and settles when its transaction has committed. */
async function store<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode), request = run(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Browser storage is unavailable.'));
  });
}
const live = (record: ResumeRecord | undefined) => record && typeof record.uploadId === 'string' && Array.isArray(record.parts) && record.expiresAt > Date.now() ? record : null;

// Private windows and blocked or full storage: every call below degrades to "nothing to resume".
async function read(key: string): Promise<ResumeRecord | null> {
  try { return live(await store<ResumeRecord | undefined>('readonly', records => records.get(key))); } catch { return null; }
}
let writes: Promise<unknown> = Promise.resolve();
/** Saves or clears one upload's notes. Writes are queued so a later one never lands first. */
function write(key: string, record: ResumeRecord | null) {
  // Structured clone copies the record now; parts added later belong to the next write.
  const snapshot = record && { ...record, parts: [...record.parts] };
  writes = writes.then(() => store('readwrite', records => (snapshot ? records.put(snapshot, key) : records.delete(key)) as IDBRequest<unknown>)).then(() => { window.dispatchEvent(new Event(changed)); }, () => undefined);
  return writes;
}

/** Interrupted uploads to one destination (`project:<id>` or `library`) that this browser can continue. */
export async function unfinishedUploads(scope: string): Promise<UnfinishedUpload[]> {
  try {
    const range = IDBKeyRange.bound(`${scope}:`, `${scope}:\uffff`);
    const [keys, records] = await Promise.all([store('readonly', all => all.getAllKeys(range)), store<ResumeRecord[]>('readonly', all => all.getAll(range))]);
    const found: UnfinishedUpload[] = [];
    records.forEach((record, index) => {
      // An expired upload cannot continue; forget it.
      if (!live(record)) { void write(String(keys[index]), null); return; }
      const sent = record.parts.length * record.partSize;
      if (sent > 0) found.push({ name: record.name, size: record.size, percent: Math.min(99, Math.floor(sent / record.size * 100)) });
    });
    return found;
  } catch { return []; }
}
/** Calls `listener` whenever this tab changes its unfinished uploads. */
export function watchUnfinishedUploads(listener: () => void) {
  window.addEventListener(changed, listener);
  return () => window.removeEventListener(changed, listener);
}

/** True while the frontend is ahead of the backend during a release: the function is not deployed yet. */
export const backendLacks = (error: unknown) => error instanceof Error && /Could not find public function/.test(error.message);

export type ResumableTransport<Id extends string, Result> = {
  /** Where this upload goes; resume notes are kept per destination. */
  scope: string;
  start: () => Promise<{ uploadId: Id; partSize: number; expiresAt?: number }>;
  /** The parts of an earlier upload that storage holds, or null when it cannot continue. */
  resume?: (uploadId: Id, parts: StoredPart[]) => Promise<{ partSize: number; expiresAt: number; parts: UploadedPart[] } | null>;
  partUrls: (uploadId: Id, from: number, count: number) => Promise<PartLink[]>;
  complete: (uploadId: Id, parts: UploadedPart[]) => Promise<Result>;
  abort: (uploadId: Id) => Promise<unknown>;
};

/** Uploads a file in parts. If the same file was interrupted earlier (a closed tab, a reload, a
 * lost connection), it continues from the parts storage already holds instead of starting over. */
export async function uploadResumable<Id extends string, Result>(file: File, transport: ResumableTransport<Id, Result>, onProgress: (percent: number, activity: UploadActivity) => void, signal?: AbortSignal, onTransferred?: () => void): Promise<Result> {
  const print = await fingerprint(file), key = print ? `${transport.scope}:${print}` : null;
  signal?.throwIfAborted();
  let uploadId: Id | undefined, record: ResumeRecord | null = null, completed = false;
  try {
    const earlier = key ? await read(key) : null;
    if (earlier && key) {
      const sameFile = earlier.name === file.name && earlier.size === file.size && earlier.lastModified === file.lastModified;
      const resumed = sameFile && transport.resume ? await transport.resume(earlier.uploadId as Id, earlier.parts).catch(error => { if (error instanceof ConvexError) return null; throw error; }) : null;
      signal?.throwIfAborted();
      if (resumed) {
        const receipts = new Map(earlier.parts.map(part => [`${part.partNumber}:${part.etag}`, part.receipt]));
        record = { ...earlier, partSize: resumed.partSize, expiresAt: resumed.expiresAt, parts: resumed.parts.map(part => ({ ...part, receipt: receipts.get(`${part.partNumber}:${part.etag}`) })) };
        uploadId = earlier.uploadId as Id;
        console.info(`[upload] ${new Date().toISOString()} Resuming an interrupted upload: ${record.parts.length} parts already stored.`);
      } else {
        // The old upload expired, was cancelled or holds another file: release it and start over.
        void write(key, null);
        void transport.abort(earlier.uploadId as Id).catch(() => undefined);
      }
    }
    if (!uploadId) {
      const opened = await transport.start();
      uploadId = opened.uploadId;
      record = { uploadId, name: file.name, size: file.size, lastModified: file.lastModified, partSize: opened.partSize, expiresAt: opened.expiresAt ?? Date.now() + 3600_000, parts: [] };
    }
    const current = record!, id = uploadId;
    if (key) void write(key, current);
    signal?.throwIfAborted();
    const parts = await uploadMultipart(file, current.partSize, {
      links: (from, count) => transport.partUrls(id, from, count),
      stored: current.parts, onProgress, signal,
      onPart: part => { current.parts.push(part); if (key) void write(key, current); },
    });
    signal?.throwIfAborted();
    onTransferred?.();
    // The bytes are stored; a passing network error must not throw the whole transfer away.
    let result: Result;
    for (let attempt = 0; ; attempt++) {
      try { result = await transport.complete(id, parts); break; }
      catch (error) {
        if (attempt >= 2 || error instanceof ConvexError || signal?.aborted) throw error;
        await new Promise(resolve => setTimeout(resolve, 1500 * 2 ** attempt));
      }
    }
    completed = true;
    if (key) void write(key, null);
    return result;
  } catch (error) {
    // A lost connection keeps the stored parts for a later resume. A cancellation or a
    // refusal releases them, as before.
    const resumable = error instanceof UploadInterruptedError && !signal?.aborted;
    if (uploadId && !completed && !resumable) {
      if (key) void write(key, null);
      await transport.abort(uploadId).catch(() => undefined);
    }
    throw error;
  }
}
