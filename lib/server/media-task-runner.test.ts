import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConvexHttpClient } from 'convex/browser';
import type { MediaWorkItem } from '../../convex/mediaTasks';
import { AnalysisError,isRetryableAnalysisError } from '../media-analysis/errors';
const mocks = vi.hoisted(() => ({ prepareComposition: vi.fn(), writeComposition: vi.fn(), runRenderWorker: vi.fn(), renderPlainExport: vi.fn(), detectShots: vi.fn(), understandVideo: vi.fn(), inspectVideo: vi.fn(), prepareVideo: vi.fn(), preparePreviewVideo:vi.fn(),probePreviewVideo:vi.fn(), downloadOwnedMedia: vi.fn(), extractTranscriptionAudio: vi.fn(), transcribeWithWhisper: vi.fn(), probeMedia: vi.fn(), extractSourceAudio: vi.fn(), measureAudioWaveform: vi.fn(), measureAudioActivity: vi.fn(), uploadMediaFile: vi.fn() }));
vi.mock('../media-analysis/detect-shots', () => ({ detectShots: mocks.detectShots }));
vi.mock('../media-analysis/gemini', async importOriginal => ({ ...await importOriginal<typeof import('../media-analysis/gemini')>(), understandVideo: mocks.understandVideo, inspectVideo: mocks.inspectVideo }));
vi.mock('../media-analysis/whisper', () => ({ transcribeWithWhisper: mocks.transcribeWithWhisper }));
vi.mock('../media-analysis/io', async importOriginal => ({ ...await importOriginal<typeof import('../media-analysis/io')>(), downloadOwnedMedia: mocks.downloadOwnedMedia, extractTranscriptionAudio: mocks.extractTranscriptionAudio, prepareVideo: mocks.prepareVideo, probeMedia: mocks.probeMedia }));
vi.mock('./extract-audio', () => ({ extractSourceAudio: mocks.extractSourceAudio }));
vi.mock('./audio-waveform', () => ({ measureAudioWaveform: mocks.measureAudioWaveform }));
vi.mock('./measure-audio-activity', () => ({ measureAudioActivity: mocks.measureAudioActivity }));
vi.mock('./upload-media-file', () => ({ uploadMediaFile: mocks.uploadMediaFile }));
vi.mock('./preview-video',()=>({preparePreviewVideo:mocks.preparePreviewVideo,probePreviewVideo:mocks.probePreviewVideo}));
vi.mock('./prepare-composition',()=>({prepareComposition:mocks.prepareComposition,writeComposition:mocks.writeComposition}));
vi.mock('./render-worker',()=>({runRenderWorker:mocks.runRenderWorker}));
vi.mock('./plain-export-render',()=>({renderPlainExport:mocks.renderPlainExport}));
import { processMediaTask } from './media-task-runner';
beforeEach(() => { mocks.probeMedia.mockResolvedValue({ duration: 3, hasVideo: true, hasAudio: true }); mocks.prepareVideo.mockImplementation(async (_input, output) => { await writeFile(output, 'proxy'); }); mocks.measureAudioActivity.mockResolvedValue(audioActivity); });
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const work = (kind: 'understand' | 'video' | 'shots' | 'transcribe' | 'extract' | 'preview') => ({ taskId: 'task', leaseToken: 'lease', projectId: 'project', kind, asset: { _id: 'asset', url: 'https://media.example.com/source', fileName: 'source.mp4', contentType: 'video/mp4', kind: 'video', size: 1, duration: 3 } }) as unknown as MediaWorkItem;
const semantic = { summary: 'A visible action.', scenes: [{ start: 0, end: 2, description: 'The person moves.', score: 0.8 }] };
const audioActivity = { version: 1 as const, duration: 3, frameSeconds: .01 as const, quiet: [{ start: 1, end: 3 }], level: { noiseFloorDb: -65, speechDb: -20, quietThresholdDb: -45, separationDb: 45 }, reliable: true };
test('provider retry declarations preserve temporary throttling and permanent failures',()=>{
  expect(isRetryableAnalysisError(new AnalysisError('Temporary timeout',408,true))).toBe(true);
  expect(isRetryableAnalysisError(new AnalysisError('Temporary throttle',429,true))).toBe(true);
  expect(isRetryableAnalysisError(new AnalysisError('Quota exhausted',429,false))).toBe(false);
  expect(isRetryableAnalysisError(new AnalysisError('Invalid evidence',502,false))).toBe(false);
  expect(isRetryableAnalysisError(new AnalysisError('Unavailable',503))).toBe(true);
  expect(isRetryableAnalysisError(new AnalysisError('Invalid source',422))).toBe(false);
  expect(isRetryableAnalysisError(new Error('Network interrupted'))).toBe(true);
});
test('playback preview uploads a parent-attached variant without creating an extracted source',async()=>{
  const signal=AbortSignal.timeout(5000),task=work('preview'),metadata={duration:3,width:1080,height:1920,fps:59.94};
  mocks.preparePreviewVideo.mockResolvedValue(metadata);mocks.uploadMediaFile.mockResolvedValue('asset');
  expect(await processMediaTask(task,{} as ConvexHttpClient,'https://fixture.convex.cloud',signal,()=>{})).toEqual({});
  expect(mocks.preparePreviewVideo).toHaveBeenCalledWith(expect.stringMatching(/source$/),expect.stringMatching(/preview\.mp4$/),signal);
  expect(mocks.uploadMediaFile).toHaveBeenCalledWith(expect.stringMatching(/preview\.mp4$/),expect.objectContaining({taskId:'task',leaseToken:'lease',projectId:'project',purpose:'preview',sourceAssetId:'asset',previewVersion:1,previewFps:59.94,kind:'video',contentType:'video/mp4',duration:3,width:1080,height:1920}),expect.any(Object),signal);
  expect(mocks.understandVideo).not.toHaveBeenCalled();expect(mocks.transcribeWithWhisper).not.toHaveBeenCalled();expect(mocks.extractSourceAudio).not.toHaveBeenCalled();
});

test('a preview retry reuses both the immutable original and prepared playback copy',async()=>{
  const cache=await mkdtemp(join(tmpdir(),'revline-preview-cache-test-'));vi.stubEnv('MEDIA_ANALYSIS_CACHE_DIR',cache);
  try{
    const task=work('preview'),metadata={duration:3,width:1080,height:1920,fps:60};
    Object.assign(task.asset!,{ownerId:'preview-owner',r2Key:'media/preview-owner/source.mp4',size:10});
    mocks.downloadOwnedMedia.mockImplementation(async(_url,path)=>writeFile(path,'1234567890'));
    mocks.preparePreviewVideo.mockImplementation(async(_input,path)=>{await writeFile(path,'preview');return metadata;});
    mocks.probePreviewVideo.mockResolvedValue(metadata);mocks.uploadMediaFile.mockRejectedValueOnce(new Error('Upload interrupted')).mockResolvedValueOnce('asset');
    await expect(processMediaTask(task,{} as ConvexHttpClient,'https://fixture.convex.cloud',AbortSignal.timeout(5000),()=>{})).rejects.toThrow('Upload interrupted');
    await expect(processMediaTask({...task,leaseToken:'retry-lease'},{} as ConvexHttpClient,'https://fixture.convex.cloud',AbortSignal.timeout(5000),()=>{})).resolves.toEqual({});
    expect(mocks.downloadOwnedMedia).toHaveBeenCalledOnce();expect(mocks.preparePreviewVideo).toHaveBeenCalledOnce();expect(mocks.probePreviewVideo).toHaveBeenCalledOnce();
  }finally{await rm(cache,{recursive:true,force:true});}
});

test('a preview uploaded before a lost completion response returns without downloading or uploading again',async()=>{
  const task=work('preview');Object.assign(task.asset!,{previewVersion:1,previewR2Key:'media/owner/project/preview',previewSize:100,previewWidth:720,previewHeight:1280,previewFps:60});
  expect(await processMediaTask(task,{} as ConvexHttpClient,'https://fixture.convex.cloud',AbortSignal.timeout(5000),()=>{})).toEqual({});
  expect(mocks.downloadOwnedMedia).not.toHaveBeenCalled();expect(mocks.preparePreviewVideo).not.toHaveBeenCalled();expect(mocks.uploadMediaFile).not.toHaveBeenCalled();
});
test('native video understanding returns semantic evidence without reporting local shot boundaries', async () => {
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'fixture-key');
  mocks.detectShots.mockRejectedValue(new AnalysisError('Shot detection did not inspect the complete video.', 502));
  mocks.understandVideo.mockResolvedValue(semantic);
  const result = await processMediaTask(work('understand'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {});
  expect(mocks.downloadOwnedMedia.mock.calls[0][5].concurrency).toBe(1);
  expect(result.analysis).toEqual({ understanding: semantic });
  expect(result.analysis).not.toHaveProperty('shots');
  expect(mocks.prepareVideo).not.toHaveBeenCalled();
});

test('large native footage gets a smaller analysis copy while inspection retains original source bounds', async () => {
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'fixture-key');
  const task = work('video'), signal = AbortSignal.timeout(5000), activity = vi.fn();
  Object.assign(task.asset!, { size: 379_302_892, width: 1440, height: 1440, duration: 175.690956 });
  mocks.probeMedia.mockResolvedValue({ duration: 175.690956, hasVideo: true, hasAudio: true });
  task.videoRequest = { question: 'Find the turn.', start: 45, end: 60 };
  await processMediaTask(task, {} as ConvexHttpClient, 'https://fixture.convex.cloud', signal, () => {}, activity);
  expect(mocks.prepareVideo).toHaveBeenCalledWith(expect.stringMatching(/source$/), expect.stringMatching(/analysis\.mp4$/), signal, 'inspection');
  expect(mocks.inspectVideo).toHaveBeenCalledWith(expect.stringMatching(/analysis\.mp4$/), 175.690956, task.videoRequest, 'fixture-key', signal, 'video/mp4', expect.any(Function));
  expect(activity.mock.calls.map(([phase]) => phase)).toEqual(['downloading', 'preparing-analysis']);
});

test('a provider retry reuses its verified source and prepared analysis video', async () => {
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'fixture-key');
  const cache = await mkdtemp(join(tmpdir(), 'revline-worker-cache-test-'));
  vi.stubEnv('MEDIA_ANALYSIS_CACHE_DIR', cache);
  try {
    const task = work('video'), signal = AbortSignal.timeout(5000);
    Object.assign(task.asset!, { ownerId: 'fixture-owner', r2Key: 'media/fixture-owner/source.mp4', size: 20_000_000, width: 1440, height: 1440 });
    task.videoRequest = { question: 'Find the turn.', start: 0, end: 2 };
    mocks.downloadOwnedMedia.mockImplementation(async (_url, output) => writeFile(output, Buffer.alloc(20_000_000)));
    mocks.inspectVideo.mockRejectedValueOnce(new AnalysisError('Gemini timed out.', 504)).mockResolvedValueOnce({ ...task.videoRequest, summary: 'The turn is visible.', uncertainty: '', matches: [] });
    await expect(processMediaTask(task, {} as ConvexHttpClient, 'https://fixture.convex.cloud', signal, () => {})).rejects.toThrow('Gemini timed out');
    const cachedActivity=vi.fn();
    await processMediaTask({ ...task, leaseToken: 'retry-lease' }, {} as ConvexHttpClient, 'https://fixture.convex.cloud', signal, () => {},cachedActivity);
    expect(cachedActivity.mock.calls.map(([phase])=>phase)).not.toContain('downloading');
    expect(mocks.downloadOwnedMedia).toHaveBeenCalledOnce();
    expect(mocks.prepareVideo).toHaveBeenCalledOnce();
    expect(mocks.inspectVideo).toHaveBeenCalledTimes(2);
  } finally { await rm(cache, { recursive: true, force: true }); }
});

test('overview uses its compact profile, but an efficient original wins if encoding grows the file', async () => {
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'fixture-key');
  const task = work('understand'), signal = AbortSignal.timeout(5000);
  Object.assign(task.asset!, { size: 20_000_000, width: 1440, height: 1440 });
  mocks.probeMedia.mockResolvedValue({ duration: 300, hasVideo: true, hasAudio: false });
  mocks.prepareVideo.mockImplementation(async (_input, output) => { await writeFile(output, Buffer.alloc(20_000_001)); });
  await processMediaTask(task, {} as ConvexHttpClient, 'https://fixture.convex.cloud', signal, () => {});
  expect(mocks.prepareVideo).toHaveBeenCalledWith(expect.any(String), expect.any(String), signal, 'overview');
  expect(mocks.understandVideo).toHaveBeenCalledWith(expect.stringMatching(/source$/), 300, 'fixture-key', signal, 'video/mp4', expect.any(Function), { projectId: task.projectId, taskId: task.taskId });
});

test('an unsupported container still uses a playable MP4 even if conversion is larger', async () => {
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'fixture-key');
  const task = work('understand'), signal = AbortSignal.timeout(5000);
  task.asset!.contentType = 'video/unknown';
  await processMediaTask(task, {} as ConvexHttpClient, 'https://fixture.convex.cloud', signal, () => {});
  expect(mocks.understandVideo).toHaveBeenCalledWith(expect.stringMatching(/analysis\.mp4$/), 3, 'fixture-key', signal, 'video/mp4', expect.any(Function), { projectId: task.projectId, taskId: task.taskId });
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
  expect(await processMediaTask(work('transcribe'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', signal, () => {})).toEqual({ analysis: { transcript, audioActivity } });
  expect(mocks.extractTranscriptionAudio).toHaveBeenCalledWith(expect.stringMatching(/source$/), expect.stringMatching(/speech\.mp3$/), signal);
  expect(mocks.transcribeWithWhisper).toHaveBeenCalledWith(expect.stringMatching(/speech\.mp3$/), 3, 'fixture-openai-key', signal);
  expect(mocks.measureAudioActivity).toHaveBeenCalledWith(expect.stringMatching(/source$/), signal, transcript);
  expect(mocks.understandVideo).not.toHaveBeenCalled();
});

test('a saved transcript and audio activity return without downloading or calling a provider again', async () => {
  const task = work('transcribe'), transcript = { words: [], segments: [] };
  task.asset!.analysis = { transcript, audioActivity };
  expect(await processMediaTask(task, {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {})).toEqual({ analysis: { transcript, audioActivity } });
  expect(mocks.downloadOwnedMedia).not.toHaveBeenCalled();
  expect(mocks.transcribeWithWhisper).not.toHaveBeenCalled();
  expect(mocks.measureAudioActivity).not.toHaveBeenCalled();
});

test('cached transcription backfills only local audio measurements from the prepared audio without provider keys', async () => {
  vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
  const task = work('transcribe'), signal = AbortSignal.timeout(5000);
  const transcript = { words: [{ text: 'Goodbye.', start: .2, end: 2.9 }], segments: [{ text: 'Goodbye.', start: .2, end: 2.9 }] };
  task.asset!.analysis = { transcript };
  task.asset!.size = 379_302_892;
  task.transcriptionAsset = { ...task.asset!, kind: 'audio', url: 'https://media.example.com/prepared-audio', size: 5_000_000 };
  const result = await processMediaTask(task, {} as ConvexHttpClient, 'https://fixture.convex.cloud', signal, () => {});
  expect(result).toEqual({ analysis: { transcript, audioActivity } });
  expect(result.analysis?.transcript).toBe(transcript);
  expect(mocks.downloadOwnedMedia).toHaveBeenCalledWith('https://media.example.com/prepared-audio', expect.any(String), 'https://fixture.convex.cloud', 5_000_000, signal, expect.any(Object));
  expect(mocks.measureAudioActivity).toHaveBeenCalledWith(expect.stringMatching(/source$/), signal, transcript);
  expect(mocks.extractTranscriptionAudio).not.toHaveBeenCalled();
  expect(mocks.transcribeWithWhisper).not.toHaveBeenCalled();
  expect(mocks.understandVideo).not.toHaveBeenCalled();
  expect(mocks.inspectVideo).not.toHaveBeenCalled();
});

test('wordless and uncertain audio measurements retain the actual empty transcription', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture-openai-key');
  const transcript = { words: [], segments: [] }, uncertain = { ...audioActivity, quiet: [], reliable: false };
  mocks.transcribeWithWhisper.mockResolvedValue(transcript);
  mocks.measureAudioActivity.mockResolvedValue(uncertain);
  expect(await processMediaTask(work('transcribe'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {})).toEqual({ analysis: { transcript, audioActivity: uncertain } });
});

test('a saved overview returns immediately without downloading or calling Gemini again', async () => {
  const task = work('understand');
  task.asset!.analysis = { understanding: semantic };
  expect(await processMediaTask(task, {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {})).toEqual({ analysis: { understanding: semantic } });
  expect(mocks.downloadOwnedMedia).not.toHaveBeenCalled();
  expect(mocks.understandVideo).not.toHaveBeenCalled();
});

test('Listening downloads prepared small audio while keeping the original video time bounds',async()=>{
  vi.stubEnv('OPENAI_API_KEY','fixture-openai-key');
  const task=work('transcribe');
  task.transcriptionAsset={...task.asset!,kind:'audio',url:'https://media.example.com/prepared-audio',size:200,duration:3.02};
  mocks.probeMedia.mockResolvedValue({duration:3.02,hasAudio:true,hasVideo:false});
  mocks.transcribeWithWhisper.mockResolvedValue({words:[],segments:[]});
  const signal=AbortSignal.timeout(5000);
  await processMediaTask(task,{} as ConvexHttpClient,'https://fixture.convex.cloud',signal,()=>{});
  expect(mocks.downloadOwnedMedia).toHaveBeenCalledWith('https://media.example.com/prepared-audio',expect.any(String),'https://fixture.convex.cloud',200,signal,expect.any(Object));
  expect(mocks.transcribeWithWhisper).toHaveBeenCalledWith(expect.any(String),3,'fixture-openai-key',signal);
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
  mocks.downloadOwnedMedia.mockImplementation(async (_url, _path, _origin, _size, _signal, options) => { options.onProgress(1, 2); options.onProgress(2, 2); });
  const progress: number[] = [], logs = vi.spyOn(console, 'log');
  const result = processMediaTask(work('extract'), {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), percent => progress.push(percent));
  await uploadStarted.promise;
  expect(mocks.measureAudioWaveform).toHaveBeenCalledOnce();
  finishWaveform.resolve(waveform);
  expect(await result).toEqual({ audioAssetId: 'audio-asset', waveform });
  expect(mocks.downloadOwnedMedia.mock.calls[0][5].concurrency).toBe(3);
  expect(progress).toContain(45);
  expect(progress).toContain(60);
  expect(progress.at(-1)).toBe(98);
  expect(progress.every((value, index) => !index || value >= progress[index - 1])).toBe(true);
  expect(logs.mock.calls.map(([message]) => message).join('\n')).toMatch(/\[\d{4}-\d{2}-\d{2}T[^\]]+\] Media task task \(extract\): Downloading source/);
  expect(logs.mock.calls.map(([message]) => message).join('\n')).not.toContain('https://');
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

test('plain exports render with FFmpeg, fall back to the browser on failure, and honor the kill switch', async () => {
  const assets = [{ _id: 'clip', fileName: 'clip.mp4', kind: 'video', url: 'https://media.example.com/clip', size: 1, width: 1920, height: 1080 }];
  const render = (clips: unknown[]) => ({ taskId: 'task', leaseToken: 'lease', projectId: 'project', kind: 'render', renderJobId: 'job', render: { timeline: { fps: 30, aspectRatio: 'landscape', clips }, assets, resolution: 1080, fps: 30, quality: 'standard' } }) as unknown as MediaWorkItem;
  const plain = render([{ id: 'a', kind: 'video', assetId: 'clip', start: 0, duration: 2, sourceStart: 0 }]);
  type Progress = (render: { progress: number }) => void;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.prepareComposition.mockResolvedValue({ assetUrls: { clip: './asset-0.mp4' }, audioSourceOffsets: {} });
  mocks.uploadMediaFile.mockResolvedValue('output');
  mocks.renderPlainExport.mockImplementation(async (...args: unknown[]) => { (args[6] as Progress)({ progress: 50 }); return { frames: 60, elapsedMs: 1 }; });
  const progress: number[] = [];
  await processMediaTask(plain, {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), value => progress.push(value));
  expect(mocks.renderPlainExport).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/video\.mp4$/), expect.objectContaining({ frames: 60, width: 1920, height: 1080 }), { clip: './asset-0.mp4' }, {}, 'standard', expect.any(Function), expect.any(AbortSignal));
  expect(mocks.writeComposition).not.toHaveBeenCalled();
  expect(mocks.runRenderWorker).not.toHaveBeenCalled();
  expect(progress).toContain(50);
  // A failed fast path keeps the export: the browser renderer runs, and progress never moves back.
  mocks.renderPlainExport.mockImplementation(async (...args: unknown[]) => { (args[6] as Progress)({ progress: 80 }); throw new Error('ffmpeg failed'); });
  mocks.runRenderWorker.mockImplementation(async (...args: unknown[]) => { (args[3] as Progress)({ progress: 10 }); (args[3] as Progress)({ progress: 100 }); return { warnings: 0 }; });
  progress.length = 0;
  await processMediaTask(plain, {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), value => progress.push(value));
  expect(mocks.runRenderWorker).toHaveBeenCalledOnce();
  expect(mocks.writeComposition).toHaveBeenCalledOnce();
  expect(warn.mock.calls.flat().join(' ')).toContain('ffmpeg failed');
  expect(progress.every((value, index) => !index || value >= progress[index - 1])).toBe(true);
  // The browser render advances from where the fast path stopped instead of stalling there.
  expect(progress.filter(value => value > 77 && value < 95).length).toBeGreaterThan(0);
  // Cancellation during the fast path is not retried in the browser.
  const cancelled = new AbortController();
  mocks.renderPlainExport.mockImplementation(async () => { cancelled.abort(); throw new Error('The render was cancelled.'); });
  await expect(processMediaTask(plain, {} as ConvexHttpClient, 'https://fixture.convex.cloud', cancelled.signal, () => {})).rejects.toThrow('cancelled');
  expect(mocks.runRenderWorker).toHaveBeenCalledOnce();
  // Composited timelines and the kill switch use the browser renderer only.
  mocks.renderPlainExport.mockClear();
  await processMediaTask(render([{ id: 'a', kind: 'video', assetId: 'clip', start: 0, duration: 2, sourceStart: 0, blendMode: 'screen' }]), {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {});
  vi.stubEnv('REVLINE_RENDER_FAST_PATH', '0');
  await processMediaTask(plain, {} as ConvexHttpClient, 'https://fixture.convex.cloud', AbortSignal.timeout(5000), () => {});
  expect(mocks.renderPlainExport).not.toHaveBeenCalled();
  expect(mocks.runRenderWorker).toHaveBeenCalledTimes(3);
});
