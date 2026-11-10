/** A signed URL that accepts one multipart part by PUT for the next `ttlMs` milliseconds. */
export type PartLink = { partNumber: number; url: string; ttlMs: number };

/** Links are requested this many at a time (the server signs at most 100 per call). */
const LINK_BATCH = 64;
/** A link this close to expiry is replaced before a part starts on it. */
const LINK_MARGIN_MS = 5 * 60_000;

/** A look-ahead cache of part links: one request signs a batch, and the next batch is
 * requested before the uploader runs out, so parts never wait on a link each. */
export function partLinkCache(fetchLinks: (from: number, count: number) => Promise<PartLink[]>, partCount: number, wanted: (partNumber: number) => boolean = () => true, lookAhead = 24) {
  // Expiry is kept on this machine's clock from the moment a link arrives; a wrong local
  // time must not make fresh links look expired.
  const cache = new Map<number, { url: string; until: number }>();
  let loading: Promise<void> | null = null;
  const fresh = (partNumber: number) => { const link = cache.get(partNumber); return link && link.until > Date.now() ? link : undefined; };
  /** The first part from `from` up to `last` that still needs a link. */
  const missing = (from: number, last: number) => { for (let n = from; n <= Math.min(last, partCount); n++) if (wanted(n) && !fresh(n)) return n; return 0; };
  const load = (from: number) => loading ??= fetchLinks(from, Math.min(LINK_BATCH, partCount - from + 1))
    .then(links => { const wall = Date.now(); for (const link of links) cache.set(link.partNumber, { url: link.url, until: wall + link.ttlMs - LINK_MARGIN_MS }); })
    .finally(() => { loading = null; });
  return {
    async get(partNumber: number): Promise<{ url: string }> {
      for (let own = 0; ; ) {
        const link = fresh(partNumber);
        if (link) {
          const next = loading ? 0 : missing(partNumber + 1, partNumber + lookAhead);
          // A failed refill is retried by the part that needs it.
          if (next) void load(next).catch(() => undefined);
          return link;
        }
        // Another part's batch may already cover this one; its failure is that part's to report.
        if (loading) { await loading.catch(() => undefined); continue; }
        if (own++ >= 2) throw new Error('Could not get an upload link. Please try again.');
        // This part's own request fails with the real error, so callers can tell what to retry.
        await load(partNumber);
      }
    },
    /** Forget a link storage refused, so the next attempt signs a new one. */
    drop(partNumber: number) { cache.delete(partNumber); },
  };
}
