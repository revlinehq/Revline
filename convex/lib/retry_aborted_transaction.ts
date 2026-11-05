/** Convex has already retried these mutations; an aborted transaction committed no writes. */
export async function retryAbortedTransaction<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await work(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 5 || !/changed while this mutation was being run/i.test(message)) throw error;
      signal?.throwIfAborted();
      await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt + Math.random() * 300));
    }
  }
}
