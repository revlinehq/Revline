import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { access } from 'node:fs/promises';
import type { ConvexHttpClient } from 'convex/browser';
import type { MediaWorkItem } from '../../convex/mediaTasks';
import { AnalysisError } from '../media-analysis/errors';
const mocks = vi.hoisted(() => ({ detectShots: vi.fn(), understandVideo: vi.fn(), prepareVideo: vi.fn(), downloadOwnedMedia: vi.fn(), extractTranscriptionAudio: vi.fn(), transcribeWithWhisper: vi.fn(), probeMedia: vi.fn(), extractSourceAudio: vi.fn(), measureAudioWaveform: vi.fn(), uploadMediaFile: vi.fn() }));
vi.mock('../media-analysis/detect-shots', () => ({ detectShots: mocks.detectShots }));
vi.mock('../media-analysis/gemini', async importOriginal => ({ ...await importOriginal<typeof import('../media-analysis/gemini')>(), understandVideo: mocks.understandVideo }));
vi.mock('../media-analysis/whisper', () => ({ transcribeWithWhisper: mocks.transcribeWithWhisper }));
vi.mock('../media-analysis/io', () => ({ downloadOwnedMedia: mocks.downloadOwnedMedia, extractTranscriptionAudio: mocks.extractTranscriptionAudio, prepareVideo: mocks.prepareVideo, probeMedia: mocks.probeMedia }));
vi.mock('./extract-audio', () => ({ extractSourceAudio: mocks.extractSourceAudio }));
vi.mock('./audio-waveform', () => ({ measureAudioWaveform: mocks.measureAudioWaveform }));
vi.mock('./upload-media-file', () => ({ uploadMediaFile: mocks.uploadMediaFile }));
import { processMediaTask } from './media-task-runner';
beforeEach(() => { mocks.probeMedia.mockResolvedValue({ duration: 3, hasVideo: true, hasAudio: true }); });
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const work = (kind: 'understand' | 'shots' | 'transcribe' | 'extract') => ({ taskId: 'task', leaseToken: 'lease', projectId: 'project', kind, asset: { _id: 'asset', url: 'https://media.example.com/source', fileName: 'source.mp4', kind: 'video', size: 1, duration: 3 } }) as unknown as MediaWorkItem;
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

test('transcription uses Whisper and compressed audio without requiring Gemini', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture-openai-key'); vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
  const transcript = { words: [{ text: 'Hello.', start: .1, end: .8 }], segments: [{ text: 'Hello.', start: .1, end: .8 }] };
  mocks.transcribeWithWhisper.mockResolvedValue(transcript);
  const signal = AbortSignal.timeout(5000);
  expect(await processMediaTask(work('transcribe'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', signal, () => {})).toEqual({ analysis: { transcript } });
  expect(mocks.extractTranscriptionAudio).toHaveBeenCalledWith(expect.stringMatching(/source$/), expect.stringMatching(/speech\.mp3$/), signal);
  expect(mocks.transcribeWithWhisper).toHaveBeenCalledWith(expect.stringMatching(/speech\.mp3$/), 3, 'fixture-openai-key', signal);
  expect(mocks.understandVideo).not.toHaveBeenCalled();
});

test('a saved transcript returns immediately without downloading or calling a provider again', async () => {
  const task = work('transcribe'), transcript = { words: [], segments: [] };
  task.asset!.analysis = { transcript };
  expect(await processMediaTask(task, {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {})).toEqual({ analysis: { transcript } });
  expect(mocks.downloadOwnedMedia).not.toHaveBeenCalled();
  expect(mocks.transcribeWithWhisper).not.toHaveBeenCalled();
});

test('transcription reports its own missing provider configuration accurately', async () => {
  vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'fixture-google-key');
  await expect(processMediaTask(work('transcribe'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining('OpenAI Whisper') });
  expect(mocks.extractTranscriptionAudio).not.toHaveBeenCalled();
  expect(mocks.transcribeWithWhisper).not.toHaveBeenCalled();
});

test('a source without audio fails before submitting a transcription', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture-key');
  mocks.probeMedia.mockResolvedValue({ duration: 3, hasAudio: false, hasVideo: true });
  await expect(processMediaTask(work('transcribe'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {})).rejects.toMatchObject({ status: 400 });
  expect(mocks.transcribeWithWhisper).not.toHaveBeenCalled();
});

test('audio upload starts while waveform processing is pending and survives until both finish', async () => {
  mocks.extractSourceAudio.mockResolvedValue(true);
  const waveform = { peaks: 'AA==', samplesPerSecond: 100 };
  const uploadStarted = Promise.withResolvers<void>();
  const finishWaveform = Promise.withResolvers<typeof waveform>();
  mocks.measureAudioWaveform.mockReturnValue(finishWaveform.promise);
  mocks.uploadMediaFile.mockImplementation(async () => { uploadStarted.resolve(); return 'audio-asset'; });
  const result = processMediaTask(work('extract'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {});
  await uploadStarted.promise;
  expect(mocks.measureAudioWaveform).toHaveBeenCalledOnce();
  finishWaveform.resolve(waveform);
  expect(await result).toEqual({ audioAssetId: 'audio-asset', waveform });
});

test('waveform failure waits for the active upload before cleaning its temporary directory', async () => {
  mocks.extractSourceAudio.mockResolvedValue(true);
  const uploadStarted = Promise.withResolvers<string>();
  const finishUpload = Promise.withResolvers<string>();
  mocks.measureAudioWaveform.mockRejectedValue(new Error('Could not measure the audio waveform.'));
  mocks.uploadMediaFile.mockImplementation((path: string) => { uploadStarted.resolve(path); return finishUpload.promise; });
  const result = processMediaTask(work('extract'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {});
  const outcome = result.catch(error => error as Error);
  const audioPath = await uploadStarted.promise;
  const directory = audioPath.slice(0, audioPath.lastIndexOf('/'));
  await expect(access(directory)).resolves.toBeUndefined();
  finishUpload.resolve('audio-asset');
  expect(await outcome).toMatchObject({ message: 'Could not measure the audio waveform.' });
  await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
});
