export function waitForDemoStep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** Local narration advances a word at a time; the same signal also stops timeline edits. */
export async function streamDemoText(text: string, signal: AbortSignal, append: (chunk: string) => void) {
  let pause = 180;
  for (const chunk of text.match(/\S+\s*/g) ?? []) {
    await waitForDemoStep(pause, signal);
    signal.throwIfAborted();
    append(chunk);
    pause = 130 + Math.min(chunk.trim().length, 12) * 8 + (/[.!?]\s*$/.test(chunk) ? 220 : /[,;:]\s*$/.test(chunk) ? 100 : 0);
  }
}
