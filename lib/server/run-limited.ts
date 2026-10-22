/** Run at most `limit` items at once. The first failure aborts the signal
 * passed to in-flight items and starts no new ones; it is rethrown once they settle. */
export async function forEachLimited<T>(items: readonly T[], limit: number, run: (item: T, signal: AbortSignal) => Promise<unknown>) {
  const stop = new AbortController();
  let next = 0, failure: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!stop.signal.aborted && next < items.length) {
      const item = items[next++];
      try { await run(item, stop.signal); } catch (error) { if (!stop.signal.aborted) { failure = error; stop.abort(); } }
    }
  }));
  if (stop.signal.aborted) throw failure;
}
