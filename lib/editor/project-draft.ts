import { FOOTAGE_DRAFT_KEY } from './opening-request';

// Browser-session draft footage. File objects remain local until an owned upload.
const databaseName = 'revline-drafts';
const storeName = 'footage';
const expiry = 60 * 60 * 1000;
type Draft = { id: string; files: File[]; expiresAt: number };
let pendingFiles: File[] | null = null;
let retainedFiles: File[] = [];
let writes: Promise<void> = Promise.resolve();
let persistenceError: Error | null = null;
let persistedDraft: Draft | null = null;

function storageError() {
  return new Error('Your browser could not save the footage for sign-in. Enable browser storage or remove the footage before continuing with Google. Your prompt is still here.');
}

function draftId(create = false) {
  let id = sessionStorage.getItem(FOOTAGE_DRAFT_KEY);
  if (!id && create) { id = crypto.randomUUID(); sessionStorage.setItem(FOOTAGE_DRAFT_KEY, id); }
  return id;
}

async function database() {
  if (typeof indexedDB === 'undefined') throw storageError();
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(storeName, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError());
    request.onblocked = () => reject(storageError());
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      // A request can succeed before the transaction fails (for example, quota exhaustion).
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(storageError());
    });
  } finally { db.close(); }
}

function serialize<T>(run: () => Promise<T>): Promise<T> {
  const operation = writes.then(run);
  writes = operation.then(() => undefined, () => undefined);
  return operation;
}

async function persist(files: File[]) {
  if (!files.length) {
    persistedDraft = null;
    // Invalidate the session pointer even if an unavailable database cannot delete
    // its old record. Removed footage must never be restored after authentication.
    let id: string | null = null;
    try { id = draftId(); sessionStorage.removeItem(FOOTAGE_DRAFT_KEY); } catch { /* No files remain to preserve. */ }
    if (id) await transaction('readwrite', store => store.delete(id)).catch(() => undefined);
    persistenceError = null;
    return;
  }
  try {
    const id = draftId(true);
    if (id) {
      // Attaching and staging the same File objects share one durable write.
      // Compare references: matching names/sizes can still contain different bytes.
      if (persistedDraft?.id === id && persistedDraft.expiresAt > Date.now() && persistedDraft.files.length === files.length && files.every((file, index) => file === persistedDraft!.files[index])) return;
      const snapshot = { id, files: [...files], expiresAt: Date.now() + expiry } satisfies Draft;
      await transaction('readwrite', store => {
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          if (entry.key !== id && (entry.value as Draft).expiresAt <= Date.now()) entry.delete();
          entry.continue();
        };
        return store.put(snapshot);
      });
      persistedDraft = snapshot;
    }
    persistenceError = null;
  } catch { persistedDraft = null; persistenceError = storageError(); }
}

/** Await before navigation. A SPA draft remains usable if IndexedDB is unavailable. */
export function stashFiles(files: File[]): Promise<void> {
  pendingFiles = [...files];
  retainedFiles = [...files];
  const snapshot = [...files];
  return serialize(() => persist(snapshot));
}

/** Claims the draft in memory; its durable copy survives until successful uploads. */
export function takeFiles(): Promise<File[]> {
  return serialize(async () => {
    if (pendingFiles === null) {
      pendingFiles = [];
      try {
        const id = draftId();
        if (id) {
          const draft = await transaction<Draft | undefined>('readonly', store => store.get(id));
          if (draft && draft.expiresAt > Date.now()) pendingFiles = draft.files;
          else if (draft) await transaction('readwrite', store => store.delete(id));
        }
      } catch { persistenceError = storageError(); throw persistenceError; }
    }
    const files = pendingFiles;
    retainedFiles = files;
    pendingFiles = [];
    return files;
  });
}

function sameFile(a: File, b: File) {
  return a.name === b.name && a.size === b.size && a.type === b.type && a.lastModified === b.lastModified;
}

/** Keep failed files recoverable after a refresh; clear only the completed imports. */
export function acknowledgeDraftFiles(imported: File[]): Promise<void> {
  return serialize(async () => {
    let remaining = retainedFiles;
    try {
      const id = draftId();
      if (id) {
        const draft = await transaction<Draft | undefined>('readonly', store => store.get(id));
        if (draft && draft.expiresAt > Date.now()) remaining = draft.files;
      }
    } catch { /* The in-memory SPA draft can still finish its owned upload. */ }
    remaining = remaining.filter(file => !imported.some(done => sameFile(file, done)));
    pendingFiles = remaining;
    retainedFiles = remaining;
    await persist(remaining);
  });
}

/** Google leaves the page, so footage must have reached durable browser storage. */
export async function prepareExternalAuthRedirect(): Promise<void> {
  await writes;
  // Authentication leaves this page; renew expiry even for an unchanged draft.
  persistedDraft = null;
  if (pendingFiles === null) await takeFiles().then(files => stashFiles(files));
  else if (retainedFiles.length) await stashFiles(retainedFiles);
  // Refresh the expiry immediately before leaving, including a long-lived SPA draft.
  await writes;
  if (retainedFiles.length && persistenceError) throw persistenceError;
}
