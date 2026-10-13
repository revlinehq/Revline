import { afterEach, expect, test, vi } from 'vitest';
import type { ConvexHttpClient } from 'convex/browser';
import type { MediaWorkItem } from '../../convex/mediaTasks';
import { AnalysisError } from '../media-analysis/errors';
const mocks = vi.hoisted(() => ({ detectShots: vi.fn(), understandVideo: vi.fn(), prepareVideo: vi.fn() }));
vi.mock('../media-analysis/detect-shots', () => ({ detectShots: mocks.detectShots }));
vi.mock('../media-analysis/gemini', async importOriginal => ({ ...await importOriginal<typeof import('../media-analysis/gemini')>(), understandVideo: mocks.understandVideo }));
vi.mock('../media-analysis/io', () => ({ downloadOwnedMedia: vi.fn(), extractSpeechAudio: vi.fn(), prepareVideo: mocks.prepareVideo, probeMedia: vi.fn().mockResolvedValue({ duration: 3, hasVideo: true, hasAudio: true }) }));
import { processMediaTask } from './media-task-runner';
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const work = (kind: 'understand' | 'shots') => ({ taskId: 'task', leaseToken: 'lease', projectId: 'project', kind, asset: { _id: 'asset', url: 'https://media.example.com/source', fileName: 'source.mp4', kind: 'video', size: 1, duration: 3 } }) as unknown as MediaWorkItem;
const semantic = { summary: 'A visible action.', scenes: [{ start: 0, end: 2, description: 'The person moves.', score: 0.8 }] };
test('native video understanding returns semantic evidence without reporting local shot boundaries', async () => {
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'fixture-key');
  mocks.detectShots.mockRejectedValue(new AnalysisError('Shot detection did not inspect the complete video.', 502));
  mocks.understandVideo.mockResolvedValue(semantic);
  const result = await processMediaTask(work('understand'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {});
  expect(result.analysis).toEqual({ understanding: semantic });
  expect(result.analysis).not.toHaveProperty('shots');
});
test('explicit shot detection remains a failure when coverage cannot be verified', async () => {
  mocks.detectShots.mockRejectedValue(new AnalysisError('Shot detection did not inspect the complete video.', 502));
  await expect(processMediaTask(work('shots'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {})).rejects.toThrow('complete video');
  expect(mocks.understandVideo).not.toHaveBeenCalled();
});
test('native video understanding does not depend on running a local shot inspection', async () => {
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'fixture-key');
  const controller = new AbortController();
  mocks.detectShots.mockImplementation(async () => { controller.abort(); throw new Error('Cancelled'); });
  mocks.understandVideo.mockResolvedValue(semantic);
  await expect(processMediaTask(work('understand'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', controller.signal, () => {})).resolves.toEqual({ analysis: { understanding: semantic } });
});
