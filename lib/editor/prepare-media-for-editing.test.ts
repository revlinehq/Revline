import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Id } from '@/convex/_generated/dataModel';
import { prepareMediaForEditing, type EditingPreparationActivity } from './prepare-media-for-editing';
import type { MediaAsset } from './types';

const projectId = 'project' as Id<'projects'>, assetId = 'source' as Id<'assets'>;
const transcript = { segments: [], words: [] };
const understanding = { summary: 'Real saved overview', scenes: [] };
const waveform = { peaks: 'AA==', samplesPerSecond: 1 };
type Kind = 'extract' | 'waveform' | 'understand' | 'transcribe';
type State = { _id: string; kind: Kind; status: 'running' | 'completed' | 'failed' | 'cancelled'; activity?: 'downloading' | 'analyzing'; error?: string };

function fixture(initial: Partial<MediaAsset> = {}) {
  const asset: MediaAsset = { _id: assetId, fileName: 'source.mp4', kind: 'video', url: '/source.mp4', ...initial };
  const tasks = new Map<Kind, State>(), activities: EditingPreparationActivity[] = [];
  const query = vi.fn(async (reference, args) => {
    if (getFunctionName(reference) === 'assets:get') return structuredClone(asset);
    if (getFunctionName(reference) === 'mediaTasks:get') return structuredClone([...tasks.values()].find(task => task._id === args.taskId)!);
    throw new Error('Unexpected query');
  });
  const mutation = vi.fn(async (reference, args: { kind: Kind; assetId: string }) => {
    expect(getFunctionName(reference)).toBe('mediaTasks:start');
    expect(args.assetId).toBe(assetId);
    const existing = tasks.get(args.kind);
    if (!existing || existing.status === 'failed' || existing.status === 'cancelled') tasks.set(args.kind, { _id: `task-${args.kind}`, kind: args.kind, status: 'running', ...(args.kind === 'extract' ? { activity: 'downloading' as const } : args.kind === 'understand' ? { activity: 'analyzing' as const } : {}) });
    return tasks.get(args.kind)!._id;
  });
  const client = { query, mutation } as unknown as Parameters<typeof prepareMediaForEditing>[0];
  return {
    asset, tasks, query, mutation, activities,
    start: () => prepareMediaForEditing(client, projectId, assetId, activity => activities.push(activity)),
    finish: (kind: Kind, patch: Partial<MediaAsset>) => { Object.assign(asset, patch); tasks.get(kind)!.status = 'completed'; },
    started: () => mutation.mock.calls.map(([, args]) => args.kind),
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });
const tick = (ms = 1000) => vi.advanceTimersByTimeAsync(ms);

test('video preparation overlaps overview/extraction, waits for both analyses, and reports one stable priority', async () => {
  const h = fixture();
  let ready = false;
  const result = h.start().then(asset => { ready = true; return asset; });
  await tick(0);
  expect(h.started()).toEqual(['extract', 'understand']);
  await tick(3000);
  expect(h.activities).toEqual([{ phase: 'processing', activity: 'Downloading footage…' }]);
  h.finish('extract', { audioExtracted: true, audioAssetId: 'separated-audio' });
  await tick();
  expect(h.started()).toEqual(['extract', 'understand', 'transcribe']);
  expect(ready).toBe(false);
  expect(h.activities.at(-1)?.phase).toBe('watching');
  h.finish('understand', { analysis: { understanding } });
  await tick();
  expect(ready).toBe(false);
  expect(h.activities.at(-1)?.phase).toBe('listening');
  h.finish('transcribe', { analysis: { understanding, transcript } });
  await tick();
  expect((await result).analysis).toEqual({ understanding, transcript });
  expect(h.activities.map(activity => activity.phase)).toEqual(['processing', 'watching', 'listening']);
});

test.each([
  { kind: 'image' as const },
  { audioExtracted: true, audioAssetId: 'audio', analysis: { understanding, transcript } },
  { audioExtracted: true, analysis: { understanding } },
  { kind: 'audio' as const, waveform, analysis: { transcript } },
])('cached or non-analyzable media is ready without starting tasks: %j', async initial => {
  const h = fixture(initial);
  expect(await h.start()).toMatchObject(initial);
  expect(h.mutation).not.toHaveBeenCalled();
  expect(h.activities).toEqual([]);
});

test('silent videos finish after overview and extraction without ever starting transcription', async () => {
  const h = fixture(), result = h.start();
  await tick(0);
  h.finish('extract', { audioExtracted: true });
  await tick();
  h.finish('understand', { analysis: { understanding } });
  await tick();
  expect((await result).audioAssetId).toBeUndefined();
  expect(h.started()).toEqual(['extract', 'understand']);
  expect(h.activities.some(activity => activity.phase === 'listening')).toBe(false);
});

test('audio-only preparation overlaps waveform and transcription and waits for saved results', async () => {
  const h = fixture({ kind: 'audio' }), result = h.start();
  await tick(0);
  expect(h.started()).toEqual(['waveform', 'transcribe']);
  h.finish('transcribe', { analysis: { transcript } });
  await tick();
  expect(h.activities.map(activity => activity.phase)).toEqual(['processing']);
  h.finish('waveform', { waveform });
  await tick();
  expect(await result).toMatchObject({ waveform, analysis: { transcript } });
});

test('failed analysis blocks readiness and retry keeps the completed mechanical preparation', async () => {
  const h = fixture(), result = expect(h.start()).rejects.toThrow('Analysis unavailable. Retry');
  await tick(0);
  h.finish('extract', { audioExtracted: true });
  Object.assign(h.tasks.get('understand')!, { status: 'failed', error: 'Analysis unavailable.' });
  await tick();
  await result;
  const retry = h.start();
  await tick(0);
  expect(h.started().filter(kind => kind === 'extract')).toHaveLength(1);
  expect(h.started().filter(kind => kind === 'understand')).toHaveLength(2);
  h.finish('understand', { analysis: { understanding } });
  await tick();
  expect(await retry).toMatchObject({ audioExtracted: true, analysis: { understanding } });
});

test('cancelled analysis and completed tasks without saved data cannot report readiness', async () => {
  const h = fixture({ audioExtracted: true });
  const cancelled = expect(h.start()).rejects.toThrow('cancelled. Retry');
  await tick(0);
  h.tasks.get('understand')!.status = 'cancelled';
  await tick();
  await cancelled;
  const missing = expect(h.start()).rejects.toThrow('without saved results. Retry');
  await tick(0);
  h.finish('understand', {});
  await tick();
  await missing;
});

test('a disconnected asset query still times out after fifteen minutes without marking ready', async () => {
  const h = fixture();
  h.query.mockImplementation(() => new Promise(() => {}));
  const result = expect(h.start()).rejects.toThrow('Retry to check the existing background tasks');
  await tick(15 * 60_000);
  await result;
  expect(h.mutation).not.toHaveBeenCalled();
  expect(h.activities).toEqual([]);
});
