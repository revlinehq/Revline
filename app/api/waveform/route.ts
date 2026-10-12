import { queueMediaRequest } from '@/lib/server/queue-media-request';
export const runtime = 'nodejs';
export async function POST(request: Request) { return queueMediaRequest(request, 'waveform'); }
