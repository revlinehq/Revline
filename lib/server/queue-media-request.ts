import { auth } from '@clerk/nextjs/server';
import { ConvexHttpClient } from 'convex/browser';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

const input = z.object({ projectId: z.string().min(1).max(128), assetId: z.string().min(1).max(128), mode: z.enum(['transcribe', 'understand', 'shots', 'beats', 'track', 'extract', 'waveform']).optional() });
export async function queueMediaRequest(request: Request, kind?: NonNullable<z.infer<typeof input>['mode']>) {
  const { userId, getToken } = await auth();
  if (!userId) return Response.json({ error: 'Sign in to process your footage.' }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!kind && !parsed.data.mode)) return Response.json({ error: 'Select a project, source and processing mode.' }, { status: 400 });
  const token = await getToken({ template: 'convex' });
  if (!token || !process.env.NEXT_PUBLIC_CONVEX_URL) return Response.json({ error: 'Your session is unavailable.' }, { status: 401 });
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL); convex.setAuth(token);
  try {
    const taskId = await convex.mutation(api.mediaTasks.start, { projectId: parsed.data.projectId as Id<'projects'>, assetId: parsed.data.assetId as Id<'assets'>, kind: kind ?? parsed.data.mode! });
    return Response.json({ taskId, status: 'queued' }, { status: 202 });
  } catch { return Response.json({ error: 'Could not queue processing for this source.' }, { status: 400 }); }
}
