import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvConfig } from '@next/env';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
loadEnvConfig(process.cwd(), true);
const appId = 'app_3IhaKL6Wz1vzw3QGkUusb094tcX';
const base = process.env.REVLINE_TEST_ORIGIN ?? 'http://localhost:3001';
const users: string[] = [];
let projectId: Id<'projects'> | undefined;
let ownerSession: string | undefined;
let stage = "initialize";
const origin = new URL(base);
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'Live fixture tests must target localhost.');
assert.ok(process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'), 'Live fixture tests require a Clerk development key.');
assert.match(process.env.CONVEX_DEPLOYMENT ?? '', /^dev:/, 'Live fixtures require a Convex dev deployment.');
function clerk<T>(path: string, method = 'GET', body?: unknown): T {
  const args = ['-y', 'clerk@latest', 'api', path, '--app', appId, '--instance', 'dev', '-X', method];
  if (body !== undefined) args.push('-d', JSON.stringify(body));
  // Preview every mutation through Clerk CLI; do not log tokens, request bodies, or headers.
  if (method !== 'GET') execFileSync('npx', [...args, '--dry-run'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const result = execFileSync('npx', [...args, '--yes'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(result) as T;
}
async function client(session: string) {
  const token = clerk<{ jwt: string }>(`/sessions/${session}/tokens/convex`, 'POST', {});
  assert.ok(token.jwt);
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, { logger: false });
  convex.setAuth(token.jwt); return convex;
}
async function localRequest(session: string, path: string, body: unknown) {
  const token = clerk<{ jwt: string }>(`/sessions/${session}/tokens`, 'POST', {});
  assert.ok(token.jwt);
  return await fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.jwt}` }, body: JSON.stringify(body) });
}
async function awaitTask(session: string, taskId: Id<'mediaTasks'>) {
  const deadline = Date.now() + 12 * 60_000;
  let convex = await client(session), refreshed = Date.now();
  while (Date.now() < deadline) {
    if (Date.now() - refreshed > 45_000) { convex = await client(session); refreshed = Date.now(); }
    const task = await convex.query(api.mediaTasks.get, { taskId });
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Background task did not finish before the integration deadline.');
}
async function awaitExport(session: string, jobId: Id<'renderJobs'>) {
  const convex = await client(session), job = await convex.query(api.renders.get, { jobId });
  assert.ok(job.taskId); const task = await awaitTask(session, job.taskId);
  assert.equal(task.status, 'completed', task.error);
  return (await client(session)).query(api.renders.get, { jobId });
}
async function uploadFixture(session: string, projectId: Id<'projects'>, path: string, name: string, duration: number) {
  const owner = await client(session), bytes = await readFile(path);
  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path], { encoding: 'utf8' }));
  const lease = await owner.action(api.r2.start, { projectId, fileName: name, contentType: 'video/mp4', kind: 'video', size: bytes.length, duration, width: metadata.streams[0].width, height: metadata.streams[0].height });
  const parts: {partNumber: number; etag: string}[] = [];
  for (let partNumber = 1; partNumber <= lease.partCount; partNumber++) {
    const url = await owner.action(api.r2.partUrl, { uploadId: lease.uploadId, partNumber });
    const response = await fetch(url, { method: 'PUT', body: bytes.subarray((partNumber - 1) * lease.partSize, partNumber * lease.partSize) });
    assert.equal(response.status, 200); parts.push(await response.json() as typeof parts[number]);
  }
  const id = await owner.action(api.r2.complete, { uploadId: lease.uploadId, parts }); assert.ok(id); return id;
}
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-live-e2e-'));
  try {
    stage = "generate source";
    const source = join(directory, 'source.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=180x320:r=24:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=180x320:r=24:d=2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    stage = "create ephemeral Clerk users";
    for (const label of ['owner', 'stranger']) {
      const user = clerk<{ id: string }>('/users', 'POST', { email_address: [`revline-e2e-${label}-${suffix}+clerk_test@example.com`], skip_password_requirement: true, first_name: 'Revline test fixture' });
      assert.ok(user.id?.startsWith('user_')); users.push(user.id);
    }
    stage = "create sessions";
    ownerSession = clerk<{ id: string }>('/sessions', 'POST', { user_id: users[0] }).id;
    const strangerSession = clerk<{ id: string }>('/sessions', 'POST', { user_id: users[1] }).id;
    stage = "issue Convex JWT and create project";
    let owner = await client(ownerSession);
    projectId = await owner.mutation(api.projects.create, { title: `Disposable E2E ${suffix}`, aspectRatio: 'vertical' });
    assert.equal((await owner.query(api.projects.get, { projectId })).ownerId, users[0]);
    const stranger = await client(strangerSession);
    await assert.rejects(stranger.query(api.projects.get, { projectId }), /Project not found/);
    stage = "open owned R2 upload";
    const sourceBytes = await readFile(source);
    const lease = await owner.action(api.r2.start, { projectId, fileName: 'source.mp4', contentType: 'video/mp4', kind: 'video', size: sourceBytes.length, duration: 3, width: 180, height: 320 });
    await assert.rejects(stranger.action(api.r2.partUrl, { uploadId: lease.uploadId, partNumber: 1 }), /another user/);
    const parts = [];
    for (let partNumber = 1; partNumber <= lease.partCount; partNumber++) {
      const uploadUrl = await owner.action(api.r2.partUrl, { uploadId: lease.uploadId, partNumber });
      assert.equal(new URL(uploadUrl).origin, process.env.MEDIA_WORKER_URL);
      const preflight = await fetch(uploadUrl, { method: 'OPTIONS', headers: { Origin: base, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
      assert.equal(preflight.headers.get('access-control-allow-origin'), base);
      const upload = await fetch(uploadUrl, { method: 'PUT', headers: { Origin: base }, body: sourceBytes.subarray((partNumber - 1) * lease.partSize, partNumber * lease.partSize) });
      assert.equal(upload.status, 200, 'Owned R2 upload failed');
      parts.push(await upload.json() as { partNumber: number; etag: string });
    }
    stage = "complete R2 upload and save timeline";
    const assetId = await owner.action(api.r2.complete, { uploadId: lease.uploadId, parts });
    assert.ok(assetId);
    const storedAsset = (await owner.query(api.assets.list, { projectId }))[0];
    assert.ok(storedAsset.r2Key && !storedAsset.storageId && storedAsset.url);
    const range = await fetch(storedAsset.url, { headers: { Range: 'bytes=0-31', Origin: base } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 32);
    assert.equal((await fetch(storedAsset.url.replace(/token=.*/, 'token=invalid'))).status, 401);
    stage = "authenticated R2 analysis download";
    const silentAnalysis = await localRequest(ownerSession, '/api/beats', { projectId, assetId });
    assert.equal(silentAnalysis.status, 202);
    const silentResult = await silentAnalysis.json() as { taskId: Id<'mediaTasks'> };
    const silentTask = await awaitTask(ownerSession, silentResult.taskId);
    assert.equal(silentTask.status, 'failed'); assert.match(silentTask.error ?? '', /no audio/, 'The worker must probe the owned R2 source');
    const shotsTaskId = await owner.mutation(api.mediaTasks.start, { projectId, assetId, kind: 'shots' });
    assert.equal((await awaitTask(ownerSession, shotsTaskId)).status, 'completed');
    owner = await client(ownerSession);
    const measured = (await owner.query(api.assets.get, { projectId, assetId })).analysis?.shots;
    assert.ok(measured && measured.shots.length === 2, 'Shot detection must find the real red-to-blue cut');
    assert.ok(Math.abs(measured.shots[0].end - 1) < 1/24);
    console.log('Background shot detection and permanent invalid-audio failure passed with no editor tab open.');
    await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: { fps: 24, aspectRatio: 'vertical', tracks: { visual: 2, overlay: 2, audio: 1 }, clips: [
      { id: 'background-source', kind: 'video', assetId, track: 1, start: 0, duration: 1, sourceStart: 0, volume: 0 },
      { id: 'trimmed-source', kind: 'video', assetId, track: 2, start: 0, duration: 1, sourceStart: 1, volume: 0, transform: { x: 0.7, y: 0.3, scale: 0.3, rotation: 0, opacity: 1 }, crop: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 } },
      { id: 'caption', kind: 'caption', start: 0, duration: 1, sourceStart: 0, text: 'Clerk + Convex + HyperFrames', fontSize: 52, color: '#FFFFFF', x: 0.5, y: 0.8, animation: 'fade' },
    ] } });
    await assert.rejects(stranger.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: { fps: 24, aspectRatio: 'square', clips: [] } }), /Project not found/);
    stage = "signed-out Next render rejection";
    const unauthorized = await fetch(base + '/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: 'test' }) });
    assert.equal(unauthorized.status, 401);
    owner = await client(ownerSession);
    const jobId = await owner.mutation(api.renders.start, { projectId, resolution: 720, fps: 24, quality: 'standard' });
    stage = "cross-user Next render rejection";
    const forbidden = await localRequest(strangerSession, '/api/render', { jobId });
    assert.equal(forbidden.status, 404, `Cross-user render HTTP ${forbidden.status}; Clerk reason ${forbidden.headers.get('x-clerk-auth-reason')}`);
    assert.equal((await owner.query(api.renders.get, { jobId })).ownerId, users[0]);
    console.log('Verified real Clerk JWT ownership, cloud upload binding, timeline persistence, cross-user denial, and signed-out render rejection. Rendering authenticated export…');
    stage = "authenticated Next render export";
    const render = await localRequest(ownerSession, '/api/render', { jobId });
    const rendered = await render.json() as { error?: string };
    assert.equal(render.status, 202, rendered.error ?? 'Authenticated export queue failed');
    owner = await client(ownerSession);
    const job = await awaitExport(ownerSession, jobId);
    assert.equal(job.status, 'completed'); assert.equal(job.progress, 100); assert.ok(job.url);
    const output = join(directory, 'downloaded.mp4');
    stage = "download stored render";
    const download = await fetch(job.url!); assert.equal(download.status, 200);
    await writeFile(output, new Uint8Array(await download.arrayBuffer()));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-show_entries', 'format=duration', '-of', 'json', output], { encoding: 'utf8' }));
    assert.ok(probe.streams.some((stream: { codec_name: string; width: number; height: number }) => stream.codec_name === 'h264' && stream.width === 720 && stream.height === 1280));
    assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.1);
    const pixel = (x: number, y: number) => execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', output, '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const subject = pixel(504, 384); const background = pixel(10, 640);
    assert.ok(subject[2] > 180 && subject[0] < 70, 'The upper layer must show the trimmed blue source at its transformed position');
    assert.ok(background[0] > 180 && background[2] < 70, 'The red lower layer must remain visible outside the transformed upper layer');
    stage = "post-render server and authentication health";
    assert.equal((await fetch(base + '/', { redirect: 'manual' })).status, 200, 'Rendering damaged the Next server response globals');
    for (const page of ['/projects', '/billing']) {
      const response = await fetch(base + page, { redirect: 'manual' });
      assert.equal(response.status, 307, `${page} must redirect signed-out visitors`);
      assert.ok(new URL(response.headers.get('location')!, base).pathname.startsWith('/sign-in'));
    }
    for (const [path, body] of [
      ['/api/render', { jobId }],
      ['/api/analyze', { projectId, assetId, mode: 'transcribe' }],
      ['/api/beats', { projectId, assetId }],
    ] as const) {
      const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 401, `${path} must reject signed-out requests after a render`);
    }
    const webhook = await fetch(new URL('/stripe/webhook', process.env.NEXT_PUBLIC_CONVEX_SITE_URL), { method: 'POST', body: '{}' });
    assert.equal(webhook.status, 503, 'Inactive billing must not process webhooks');
    stage = "repeat authenticated render";
    owner = await client(ownerSession);
    const secondJobId = await owner.mutation(api.renders.start, { projectId, resolution: 720, fps: 24, quality: 'standard' });
    const secondRender = await localRequest(ownerSession, '/api/render', { jobId: secondJobId });
    const secondResult = await secondRender.json() as { error?: string };
    assert.equal(secondRender.status, 202, secondResult.error ?? 'A second export must queue in the same server process');
    owner = await client(ownerSession);
    assert.equal((await awaitExport(ownerSession, secondJobId)).status, 'completed');
    assert.equal((await fetch(base + '/')).status, 200, 'Server must remain healthy after repeated exports');
    if (process.env.REVLINE_SPEECH_FIXTURE) {
      stage = 'background speech-media preparation';
      const path = process.env.REVLINE_SPEECH_FIXTURE;
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path], { encoding: 'utf8' }));
      const speechId = await uploadFixture(ownerSession, projectId, path, 'public-domain-nasa.mp4', Number(probe.format.duration));
      owner = await client(ownerSession);
      const preparationId = await owner.mutation(api.mediaTasks.start, { projectId, assetId: speechId, kind: 'extract' });
      const preparation = await awaitTask(ownerSession, preparationId); assert.equal(preparation.status, 'completed', preparation.error);
      owner = await client(ownerSession);
      const prepared = await owner.query(api.assets.get, { projectId, assetId: speechId });
      assert.ok(prepared.audioExtracted && prepared.audioAssetId);
      const audio = await owner.query(api.assets.get, { projectId, assetId: prepared.audioAssetId });
      assert.ok(audio.r2Key && audio.url && audio.waveform && Math.max(...Buffer.from(audio.waveform.peaks, 'base64')) > 2, 'Real audio peaks must be saved on the owned extracted source');
      for (const kind of ['transcribe', 'understand', 'beats'] as const) {
        stage = 'background ' + kind;
        const taskId = await (await client(ownerSession)).mutation(api.mediaTasks.start, { projectId, assetId: speechId, kind });
        const task = await awaitTask(ownerSession, taskId); assert.equal(task.status, 'completed', task.error);
      }
      const analyzed = await (await client(ownerSession)).query(api.assets.get, { projectId, assetId: speechId });
      assert.ok(analyzed.analysis?.transcript?.words.length && analyzed.analysis?.understanding?.scenes.length && analyzed.analysis?.shots?.shots.length);
      assert.ok(analyzed.analysis?.beats);
      console.log('Background AAC extraction, measured waveforms, Gemini word timestamps, Gemini agentic descriptions, shot boundaries and beat detection passed without an editor.');
    }
    console.log('Live integration passed: Clerk→owned R2 upload→saved two-layer timeline with source trims/transform/crop→queued Workflow/worker export→R2 stored/downloaded 720×1280 H.264 MP4. Pixel checks verified the red background and positioned blue upper layer.');
    console.log('Repeated authenticated export passed; landing page, protected redirects, signed-out API rejection, and disabled Stripe webhook remain healthy after rendering.');

  } finally {
    if (projectId && ownerSession) {
      const owner = await client(ownerSession);
      const jobs = await owner.query(api.renders.list, { projectId });
      for (const job of jobs) if (job.status === 'queued' || job.status === 'rendering') await owner.mutation(api.renders.fail, { jobId: job._id, workerSecret: process.env.RENDER_WORKER_SECRET!, error: 'Disposable integration fixture cleanup' });
      await owner.mutation(api.projects.remove, { projectId });
    }
    for (const userId of users) clerk(`/users/${userId}`, 'DELETE');
    await rm(directory, { recursive: true, force: true });
    console.log('Removed all disposable test project storage, jobs, Clerk users, and sessions.');
  }
}
main().catch(error => { console.error(`Live integration failed at ${stage}: ${error instanceof Error ? error.message : "unknown error"}`); if (error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause) console.error(`Network code: ${String(error.cause.code)}`); process.exitCode = 1; });
