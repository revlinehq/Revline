import { auth } from '@clerk/nextjs/server';
import { openAiCosts, OpenAiCostsError } from '@/lib/server/openai-costs';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
function errorResponse(error: unknown) {
  return Response.json({ error: error instanceof OpenAiCostsError ? error.message : 'The local costs connection failed. Try again.' }, { status: error instanceof OpenAiCostsError ? error.status : 500, headers });
}
async function authorize(request: Request, mutation = false) {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 });
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return new Response(null, { status: 404 });
  const origin = request.headers.get('origin');
  if ((mutation && origin !== url.origin) || (origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response(null, { status: 403 });
  const { userId } = await auth();
  return userId ?? new Response(null, { status: 401 });
}
export async function GET(request: Request) {
  const owner = await authorize(request);
  if (owner instanceof Response) return owner;
  const period = new URL(request.url).searchParams.get('days') ?? '7';
  if (period !== '7' && period !== '30') return Response.json({ error: 'Choose 7 or 30 days.' }, { status: 400, headers });
  try { return Response.json(await openAiCosts.report(owner, Number(period) as 7 | 30), { headers }); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  const owner = await authorize(request, true);
  if (owner instanceof Response) return owner;
  if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 415 });
  if (Number(request.headers.get('content-length')) > 4096) return new Response(null, { status: 413 });
  try {
    const text = await request.text();
    if (text.length > 4096) return new Response(null, { status: 413 });
    let value: unknown;
    try { value = JSON.parse(text); } catch { return Response.json({ error: 'Enter a valid connection.' }, { status: 400, headers }); }
    return Response.json(await openAiCosts.connect(owner, value), { headers });
  } catch (error) { return errorResponse(error); }
}
