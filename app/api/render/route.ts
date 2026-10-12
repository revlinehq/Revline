import { auth } from '@clerk/nextjs/server';
import { ConvexHttpClient } from 'convex/browser';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
export const runtime = 'nodejs';
const input = z.object({ jobId: z.string().min(1).max(128) });
export async function POST(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) return Response.json({ error: 'Sign in to export a video.' }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Select an export job.' }, { status: 400 });
  const token = await getToken({ template: 'convex' });
  if (!token || !process.env.NEXT_PUBLIC_CONVEX_URL) return Response.json({ error: 'Your session is unavailable.' }, { status: 401 });
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL); convex.setAuth(token);
  try {
    const job = await convex.query(api.renders.get, { jobId: parsed.data.jobId as Id<'renderJobs'> });
    return Response.json({ jobId: job._id, status: job.status }, { status: 202 });
  } catch { return Response.json({ error: 'Export not found.' }, { status: 404 }); }
}
