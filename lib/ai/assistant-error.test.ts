import { APICallError } from 'ai';
import { expect, test } from 'vitest';
import { assistantFailureReason } from './assistant-error';

function apiError(statusCode: number, message: string) {
  return new APICallError({ message, statusCode, url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, responseBody: JSON.stringify({ error: { message } }) });
}

test('actual SDK insufficient-credit errors give billing recovery rather than model configuration advice', () => {
  const reason = assistantFailureReason(apiError(400, 'Your credit balance is too low to access the Anthropic API. Secret request data must not leak.'));
  expect(reason).toContain('credits are exhausted');
  expect(reason).toContain('saved edits remain');
  expect(reason).not.toContain('Secret request data');
  expect(assistantFailureReason({ cause: { lastError: apiError(402, 'Insufficient credits') } })).toBe(reason);
});

test.each([401, 429, 503, 529])('provider %i failures give safe recovery without exposing raw errors', statusCode => {
  const reason = assistantFailureReason(apiError(statusCode, 'Private credentials and raw request body'));
  expect(reason).not.toBeNull();
  expect(reason).not.toContain('Private credentials');
});

test('unknown failures and cyclic error causes remain generic', () => {
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  expect(assistantFailureReason(cyclic)).toBeNull();
  expect(assistantFailureReason(apiError(400, 'Unrelated schema failure'))).toBeNull();
  expect(assistantFailureReason(new Error('The timeline changed elsewhere'))).toBeNull();
});
