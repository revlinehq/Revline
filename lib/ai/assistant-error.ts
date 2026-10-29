/** Safe recovery text for provider failures, without exposing request bodies or credentials. */
export function assistantFailureReason(error: unknown, provider: 'anthropic' | 'gateway' | 'google' | 'openai' = 'anthropic'): string | null {
  const name = provider === 'openai' ? 'OpenAI' : provider === 'gateway' ? 'The AI Gateway' : provider === 'google' ? 'Gemini' : 'Claude';
  const seen = new Set<object>();
  function inspect(value: unknown, depth: number): string | null {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return null;
    seen.add(value);
    const item = value as { statusCode?: number; message?: unknown; responseBody?: unknown; cause?: unknown; lastError?: unknown };
    const detail = [item.message, item.responseBody].filter(part => typeof part === 'string').join(' ');
    if ((item.statusCode === 400 || item.statusCode === 402 || item.statusCode === 429) && /credit balance|insufficient (?:credits|funds|quota)|insufficient_quota|billing.*(?:balance|limit)|exceeded your current quota/i.test(detail)) {
      return provider === 'openai' ? 'OpenAI API credits or spending limits are exhausted. Your saved edits remain. Check billing in the OpenAI API platform before continuing.' : provider === 'gateway' ? 'The AI Gateway reached its billing limit. Your saved edits remain. Check the Convex team billing before continuing.' : provider === 'google' ? 'Gemini API credits or spending limits are exhausted. Your saved edits remain. Check billing in Google AI Studio before continuing.' : 'Claude API credits are exhausted. Your saved edits remain. Restore credits in the Claude Console before continuing.';
    }
    if (item.statusCode === 401) return `${name} API authentication failed. Check the backend API key before continuing.`;
    if (item.statusCode === 403 || (item.statusCode === 404 && /model/i.test(detail))) return `${name} cannot access the selected model. Check the backend account's model access before continuing.`;
    if (item.statusCode === 429) return `${name} reached an API rate or usage limit. Your saved edits remain; retry after the limit resets.`;
    if (item.statusCode === 529 || item.statusCode === 503) return `${name} is temporarily unavailable. Your saved edits remain; try again later.`;
    return inspect(item.lastError, depth + 1) ?? inspect(item.cause, depth + 1);
  }
  return inspect(error, 0);
}
