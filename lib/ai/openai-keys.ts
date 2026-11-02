import { createOpenAI } from '@ai-sdk/openai';

/**
 * OPENAI_API_KEY is the main key; OPENAI_API_KEY_FALLBACK takes over when the main account
 * is out of credit. After a switch the fallback is used for a while before the main key is tried again.
 */
const RETRY_PRIMARY_AFTER_MS = 10 * 60_000;
let primaryOutOfCreditUntil = 0;

const keys = () => ({ primary: process.env.OPENAI_API_KEY?.trim() || '', fallback: process.env.OPENAI_API_KEY_FALLBACK?.trim() || '' });

/** The key requests should use right now. */
export function activeOpenAIKey() {
  const { primary, fallback } = keys();
  return fallback && (!primary || Date.now() < primaryOutOfCreditUntil) ? fallback : primary;
}

/** OpenAI answers 429 insufficient_quota (or a billing code) when the account has no credit left. */
async function outOfCredit(response: Response) {
  if (response.status !== 429 && response.status !== 402) return false;
  try {
    const error = ((await response.clone().json()) as { error?: { code?: string; type?: string } } | null)?.error;
    return ['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active'].includes(error?.code ?? error?.type ?? '');
  } catch { return false; }
}

/** A fetch that sends the active key and retries once with the fallback key when the main account is out of credit. */
async function openAIFetch(input: RequestInfo | URL, init?: RequestInit) {
  const { primary, fallback } = keys();
  const send = (key: string) => { const headers = new Headers(init?.headers); headers.set('authorization', `Bearer ${key}`); return fetch(input, { ...init, headers }); };
  const key = activeOpenAIKey();
  const response = await send(key);
  if (!fallback || key !== primary || !await outOfCredit(response)) return response;
  primaryOutOfCreditUntil = Date.now() + RETRY_PRIMARY_AFTER_MS;
  console.warn('[openai] The main OpenAI key is out of credit; using OPENAI_API_KEY_FALLBACK for the next 10 minutes.');
  return send(fallback);
}

/** The editor's OpenAI provider, with the key fallback built in. */
export function editorOpenAI() {
  return createOpenAI({ apiKey: activeOpenAIKey(), fetch: openAIFetch });
}
