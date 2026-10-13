import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { separateVideoClips } from '../lib/editor/operations';
import type { Timeline, MediaAsset } from '../lib/editor/types';

loadEnvConfig(process.cwd(), true);
const exec = promisify(execFile);
const deployment = process.env.CONVEX_DEPLOYMENT?.replace(/^dev:/, '');
const subject = process.env.REVLINE_IMPORT_TEST_OWNER;
assert.ok(process.env.CONVEX_DEPLOYMENT?.startsWith('dev:'), 'This disposable test only runs on development.');
assert.ok(subject, 'Set REVLINE_IMPORT_TEST_OWNER to a development user with sandbox editor access.');
const identity = JSON.stringify({ subject, issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: `video-import-smoke|${subject}` });
async function call<T>(name: string, args: unknown): Promise<T> {
  const { stdout } = await exec('node', ['node_modules/convex/bin/main.js', 'run', name, JSON.stringify(args), '--deployment', deployment!, '--identity', identity], { maxBuffer: 2 * 1024 * 1024 });
  return (stdout.trim() ? JSON.parse(stdout) : null) as T;
}
async function waitFor<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    const value = await read(); if (ready(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('The background video import did not finish in time.');
}
async function main() {
  for (const url of ['https://media.w3.org/2010/05/sintel/trailer.mp4', 'https://www.youtube.com/watch?v=xqIH1jFTrCc']) {
    let projectId: string | undefined;
    try {
      const result = await call<{ projectId: string; taskId: string }>('mediaTasks:importVideo', { url });
      projectId = result.projectId;
      const task = await waitFor(() => call<{ status: string; error?: string }>('mediaTasks:get', { taskId: result.taskId }), value => ['completed','failed','cancelled'].includes(value.status));
      assert.equal(task.status, 'completed', task.error);
      const project = await call<{ timeline: Timeline; revision: number }>('projects:get', { projectId });
      assert.equal(project.timeline.clips.length, 1);
      const clip = project.timeline.clips[0]; assert.equal(clip.kind, 'video'); assert.ok(clip.assetId);
      const asset = await waitFor(() => call<MediaAsset & { r2Key?: string; storageId?: string }>('assets:get', { projectId, assetId: clip.assetId }), value => !!value.audioExtracted);
      assert.ok(asset.r2Key && !asset.storageId && asset.url, 'Imported media must be privately stored in R2.');
      const range = await fetch(asset.url!, { headers: { Range: 'bytes=0-31' } }); assert.equal(range.status, 206);
      assert.ok(asset.audioAssetId, 'This fixture includes audio, which must be extracted.');
      const audio = await call<MediaAsset>('assets:get', { projectId, assetId: asset.audioAssetId });
      assert.ok(audio.url && audio.waveform?.peaks.length, 'Audio must be playable with measured waveform peaks.');
      await call('projects:saveTimeline', { projectId, expectedRevision: project.revision, timeline: separateVideoClips(project.timeline, asset) });
      const reopened = await call<{ timeline: Timeline }>('projects:get', { projectId });
      assert.equal(reopened.timeline.clips.length, 2); assert.ok(reopened.timeline.clips.some(clip => clip.kind === 'audio'));
      console.log(`${url.includes('youtube') ? 'YouTube' : 'Direct MP4'} passed: durable import, private R2 video/audio, timeline clip, waveform, and reopened edit.`);
    } finally {
      if (projectId) await call('projects:remove', { projectId });
    }
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Video import failed.'); process.exitCode = 1; });
