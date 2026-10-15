import { stockAudioResponse } from '@/lib/server/stock-audio-response';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return stockAudioResponse(request, (await context.params).id);
}
export const HEAD = GET;
