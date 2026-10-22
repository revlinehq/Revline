/** Run at most `limit` items at once. After a failure no new item starts;
 * in-flight items settle before the first error is rethrown. */
export async function forEachLimited<T>(items: readonly T[], limit: number, run: (item: T) => Promise<unknown>) {
  let next = 0, failed = false, failure: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try { await run(item); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
}
