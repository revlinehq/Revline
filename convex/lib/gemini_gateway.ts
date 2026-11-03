import { getServiceToken } from 'convex/server';
import { GEMINI_GATEWAY_BODY_LIMIT } from '../../lib/ai/gemini-routing';

const failure = (message: string, status: number) => new Response(JSON.stringify({ error: { message } }), { status, headers: { 'content-type': 'application/json' } });

/** Only called inside an authenticated action. The deployment token never leaves Convex. */
export async function fetchGeminiGateway(body: string, signal?: AbortSignal): Promise<Response> {
  if (new TextEncoder().encode(body).byteLength > GEMINI_GATEWAY_BODY_LIMIT) return failure('Convex AI Gateway accepts at most 16 MiB of JSON, including base64 images. Reduce the requested window or image count; images are never silently reduced.', 413);
  let request: Record<string, unknown>;
  try { request = JSON.parse(body); } catch { return failure('Invalid Gemini request JSON.', 400); }
  if (!request || typeof request.model !== 'string' || !/^google\/gemini-[a-z0-9.-]+$/.test(request.model) || !Array.isArray(request.messages)) return failure('The Gemini gateway route requires a google/gemini model and chat messages.', 400);
  let token: string;
  try { token = await getServiceToken('ai-gateway'); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const code = ['AiGatewayDisabled', 'AiGatewayUnavailable', 'SpendingLimitExceeded', 'TeamSuspended'].find(value => detail.includes(value));
    return failure(`Convex AI Gateway unavailable${code ? ` (${code})` : ''}. A paid Convex team with Gateway access and available spending allowance is required.`, 403);
  }
  // Require support for schemas, tools and reasoning instead of silently dropping them.
  const provider = request.provider && typeof request.provider === 'object' ? request.provider : {};
  const payload = JSON.stringify({ ...request, provider: { ...provider, require_parameters: true } });
  if (new TextEncoder().encode(payload).byteLength > GEMINI_GATEWAY_BODY_LIMIT) return failure('Convex AI Gateway accepts at most 16 MiB of JSON.', 413);
  return fetch('https://ai-gateway.convex.dev/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: payload, signal });
}
