/** Safe recovery text for provider failures, without exposing request bodies or credentials. */
export function assistantFailureReason(error: unknown): string | null {
  const seen = new Set<object>();
  function inspect(value: unknown, depth: number): string | null {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return null;
    seen.add(value);
    const item = value as { statusCode?: number; message?: unknown; responseBody?: unknown; cause?: unknown; lastError?: unknown };
    const detail = [item.message, item.responseBody].filter(part => typeof part === 'string').join(' ');
    if ((item.statusCode === 400 || item.statusCode === 402) && /credit balance|insufficient (?:credits|funds)|billing.*(?:balance|limit)/i.test(detail)) {
      return 'Claude API credits are exhausted. Your saved edits remain. Restore credits in the Claude Console before continuing.';
    }
    if (item.statusCode === 401) return 'Claude API authentication failed. Check the backend API key before continuing.';
    if (item.statusCode === 429) return 'Claude reached an API rate or usage limit. Your saved edits remain; retry after the limit resets.';
    if (item.statusCode === 529 || item.statusCode === 503) return 'Claude is temporarily unavailable. Your saved edits remain; try again later.';
    return inspect(item.lastError, depth + 1) ?? inspect(item.cause, depth + 1);
  }
  return inspect(error, 0);
}
