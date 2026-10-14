import { auth } from '@clerk/nextjs/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const runtime = 'nodejs';
const maxBytes = 20 * 1024 * 1024;
const run = promisify(execFile);

export async function GET() {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 });
  if (!(await auth()).userId) return new Response(null, { status: 401 });
  return Response.json({ configured: !!process.env.META_MODEL_API_KEY }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  // This experiment must remain unreachable in hosted production, even if a key is configured there.
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 });
  if (!(await auth()).userId) return Response.json({ error: 'Sign in to test masks.' }, { status: 401 });
  const key = process.env.META_MODEL_API_KEY;
  if (!key) return Response.json({ error: 'Add META_MODEL_API_KEY to .env.local to connect Meta.' }, { status: 503 });
  if (Number(request.headers.get('content-length')) > maxBytes + 4096) return Response.json({ error: 'Use a clip under 20 MB.' }, { status: 413 });
  let directory: string | undefined;
  try {
    const form = await request.formData();
    const file = form.get('video'), prompt = form.get('prompt');
    if (!(file instanceof File) || !['video/mp4', 'video/quicktime'].includes(file.type) || !file.size || file.size > maxBytes) return Response.json({ error: 'Choose an MP4 or MOV under 20 MB.' }, { status: 400 });
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.trim().length > 120) return Response.json({ error: 'Name one subject, such as “person” or “red bicycle”.' }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    directory = await mkdtemp(join(tmpdir(), 'revline-sam-lab-'));
    const input = join(directory, 'clip.mp4');
    await writeFile(input, bytes);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration:stream=codec_name,width,height,avg_frame_rate,nb_frames', '-of', 'json', input], { signal: request.signal, timeout: 15_000, maxBuffer: 1024 * 1024 });
    const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; nb_frames?: string }[] };
    const video = probe.streams?.[0];
    const duration = Number(probe.format?.duration);
    const [numerator, denominator] = (video?.avg_frame_rate ?? '').split('/').map(Number);
    const fps = numerator / denominator;
    const frames = Number(video?.nb_frames) || Math.ceil(duration * fps);
    if (!video || !['h264', 'hevc', 'mpeg4'].includes(video.codec_name ?? '') || !Number.isFinite(duration) || duration <= 0 || duration > 10.05 || !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(frames) || frames > 600 || !video.width || !video.height || video.width * video.height > 1920 * 1080) return Response.json({ error: 'For this test use up to 10 seconds, 600 frames, and 1080p, encoded as H.264, H.265, or MPEG-4.' }, { status: 400 });
    const upstream = await fetch('https://api.meta.ai/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
      body: JSON.stringify({ model: 'sam-3.1', stream: true, metadata: { mask_encoding: 'one_bit' }, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt.trim() }, { type: 'input_video', video_url: `data:${file.type};base64,${bytes.toString('base64')}` }] }] }),
    });
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      const error = upstream.status === 402 ? 'Meta billing is not configured or verification failed. Check your payment method in Meta Model API.' : upstream.status === 401 || upstream.status === 403 || upstream.status === 404 ? 'Meta rejected this key or SAM model access. Check your Meta project.' : upstream.status === 429 ? 'Meta is rate limited or out of available credits. Check usage and billing.' : 'Meta could not process this clip. Try another short MP4.';
      return Response.json({ error }, { status: upstream.status === 402 || upstream.status === 429 ? upstream.status : 502 });
    }
    return new Response(upstream.body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ error: error instanceof Error && error.name === 'TimeoutError' ? 'Meta took too long. Try a shorter clip.' : 'Could not read or segment this clip. Check that ffprobe is installed and choose a valid MP4.' }, { status: 400 });
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}
