/** Safe recovery text for provider failures, without exposing request bodies or credentials. */
export function assistantFailureReason(error: unknown, provider: 'anthropic' | 'gateway' | 'openai' = 'anthropic'): string | null {
  const name = provider === 'openai' ? 'OpenAI' : provider === 'gateway' ? 'The AI Gateway' : 'Claude';
  const seen = new Set<object>();
  function inspect(value: unknown, depth: number): string | null {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return null;
    seen.add(value);
    const item = value as { statusCode?: number; message?: unknown; responseBody?: unknown; cause?: unknown; lastError?: unknown };
    const detail = [item.message, item.responseBody].filter(part => typeof part === 'string').join(' ');
    if ((item.statusCode === 400 || item.statusCode === 402 || item.statusCode === 429) && /credit balance|credits are (?:depleted|exhausted)|insufficient (?:credits|funds|quota)|insufficient_quota|billing.*(?:balance|limit)|exceeded your current quota/i.test(detail)) {
      return provider === 'openai' ? 'OpenAI API credits or spending limits are exhausted. Your saved edits remain. Check billing in the OpenAI API platform before continuing.' : provider === 'gateway' ? 'The AI Gateway reached its billing limit. Your saved edits remain. Check the Convex team billing before continuing.' : 'Claude API credits are exhausted. Your saved edits remain. Restore credits in the Claude Console before continuing.';
    }
    if (item.statusCode === 401) return `${name} API authentication failed. Check the backend API key before continuing.`;
    if (item.statusCode === 403 || (item.statusCode === 404 && /model/i.test(detail))) return `${name} cannot access the selected model. Check the backend account's model access before continuing.`;
    if (item.statusCode === 429) return `${name} reached an API rate or usage limit. Your saved edits remain; retry after the limit resets.`;
    if (item.statusCode === 529 || item.statusCode === 503) return `${name} is temporarily unavailable. Your saved edits remain; try again later.`;
    return inspect(item.lastError, depth + 1) ?? inspect(item.cause, depth + 1);
  }
  return inspect(error, 0);
}

/** The provider's own words (or the error's, when it is not the provider's) for a failure nothing above recognizes,
 * so the chat says what went wrong instead of a generic line. Only the error message and status are used (never request bodies), keys and tokens are masked, and
 * the text is capped. */
export function providerErrorText(error: unknown, provider: 'anthropic' | 'gateway' | 'openai' = 'anthropic'): string | null {
  const name = provider === 'openai' ? 'OpenAI' : provider === 'gateway' ? 'The AI Gateway' : 'Claude';
  const seen = new Set<object>();
  let status: number | undefined, detail = '', said = '';
  const fromBody = (body: unknown) => {
    if (typeof body !== 'string') return '';
    try { const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown }; const message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message; return typeof message === 'string' ? message : ''; }
    catch { return body.length < 400 && !body.trimStart().startsWith('<') ? body : ''; }
  };
  (function inspect(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return;
    seen.add(value);
    const item = value as { statusCode?: unknown; message?: unknown; responseBody?: unknown; cause?: unknown; lastError?: unknown };
    if (typeof item.statusCode === 'number') status ??= item.statusCode;
    // The provider's response body says more than the SDK's wrapper messages ("Failed after 3 attempts…").
    said ||= fromBody(item.responseBody);
    if (!detail && typeof item.message === 'string') detail = item.message;
    inspect(item.lastError, depth + 1); inspect(item.cause, depth + 1);
  })(error, 0);
  detail = (said || detail).replace(/\b(?:AIza[\w-]{20,}|sk-[\w-]{12,}|(?:Bearer|key=)\s*[\w.-]{12,})/g, '[redacted]').replace(/\s+/g, ' ').trim();
  if (!detail) return null;
  const text = detail.length > 300 ? `${detail.slice(0, 300)}…` : detail;
  // Without a status or response body the error came from Revline's side, not the provider.
  return status || said ? `${name} returned an error${status ? ` (${status})` : ''}: ${text}` : `The assistant stopped on an error: ${text}`;
}
