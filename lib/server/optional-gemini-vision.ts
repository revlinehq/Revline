/** Paid vision remains opt-in; the shared Gemini router handles rejected direct keys. */
export async function optionalGeminiVision<T>(signal: AbortSignal, work: (key: string) => Promise<T>): Promise<T | undefined> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
  if (process.env.MEDIA_VISION_GEMINI_FALLBACK !== 'true') return undefined;
  try { return await work(key); }
  catch (error) {
    signal.throwIfAborted();
    console.warn('[media-analysis] Optional Gemini vision unavailable.', error instanceof Error ? error.message : 'Request failed.');
    return undefined;
  }
}
