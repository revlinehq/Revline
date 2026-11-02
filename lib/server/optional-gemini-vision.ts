import { AnalysisError } from '../media-analysis/errors';

const unavailableKeys = new Set<string>();

/** Paid fallback is opt-in. A rejected key cannot repeatedly block local vision jobs. */
export async function optionalGeminiVision<T>(signal: AbortSignal, work: (key: string) => Promise<T>): Promise<T | undefined> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (process.env.MEDIA_VISION_GEMINI_FALLBACK !== 'true' || !key || unavailableKeys.has(key)) return undefined;
  try { return await work(key); }
  catch (error) {
    signal.throwIfAborted();
    if (error instanceof AnalysisError && (error.status === 401 || error.status === 402 || error.status === 403 || error.retryable === false)) unavailableKeys.add(key);
    return undefined;
  }
}
