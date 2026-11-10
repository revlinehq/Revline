/** A signed URL that accepts one multipart part by PUT until `expiresAt`. */
export type PartLink = { partNumber: number; url: string; expiresAt: number };

/** Links are requested this many at a time (the server signs at most 100 per call). */
const LINK_BATCH = 64;
/** A link this close to expiry is replaced before a part starts on it. */
const LINK_MARGIN_MS = 5 * 60_000;

/** A look-ahead cache of part links: one request signs a batch, and the next batch is
 * requested before the uploader runs out, so parts never wait on a link each. */
export function partLinkCache(fetchLinks: (from: number, count: number) => Promise<PartLink[]>, partCount: number, wanted: (partNumber: number) => boolean = () => true, lookAhead = 24) {
  const cache = new Map<number, PartLink>();
  let loading: Promise<void> | null = null;
  const fresh = (partNumber: number) => { const link = cache.get(partNumber); return link && link.expiresAt - Date.now() > LINK_MARGIN_MS ? link : undefined; };
  /** The first part from `from` up to `last` that still needs a link. */
  const missing = (from: number, last: number) => { for (let n = from; n <= Math.min(last, partCount); n++) if (wanted(n) && !fresh(n)) return n; return 0; };
  const load = (from: number) => loading ??= fetchLinks(from, Math.min(LINK_BATCH, partCount - from + 1))
    .then(links => { for (const link of links) cache.set(link.partNumber, link); })
    .finally(() => { loading = null; });
  return {
    async get(partNumber: number): Promise<PartLink> {
      for (let tries = 0; tries < 4; tries++) {
        const link = fresh(partNumber);
        if (link) {
          const next = loading ? 0 : missing(partNumber + 1, partNumber + lookAhead);
          // A failed refill is retried by the part that needs it.
          if (next) void load(next).catch(() => undefined);
          return link;
        }
        // Another part's batch may already cover this one.
        if (loading) await loading.catch(() => undefined); else await load(partNumber);
      }
      throw new Error('Could not get an upload link. Please try again.');
    },
    /** Forget a link storage refused, so the next attempt signs a new one. */
    drop(partNumber: number) { cache.delete(partNumber); },
  };
}
