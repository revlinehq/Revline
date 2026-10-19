import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConvexHttpClient } from 'convex/browser';
import type { MediaWorkItem, MediaTaskResult } from '@/convex/mediaTasks';
import { dimensions, timelineDuration, type MediaAsset } from '@/lib/editor/types';
import { downloadOwnedMedia, extractTranscriptionAudio, needsAnalysisVideoProxy, prepareVideo, probeMedia } from '@/lib/media-analysis/io';
import { inspectVideo, inspectVideoFrames, understandVideo } from '@/lib/media-analysis/gemini';
import { transcribeWithWhisper } from '@/lib/media-analysis/whisper';
import { detectShots } from '@/lib/media-analysis/detect-shots';
import { detectMusicBeats } from '@/lib/media-analysis/music-beats';
import { AnalysisError } from '@/lib/media-analysis/errors';
import { trackSourceFace } from './track-source-face';
import { extractSourceAudio } from './extract-audio';
import { measureAudioWaveform } from './audio-waveform';
import { measureAudioActivity } from './measure-audio-activity';
import { mediaSourceCacheIdentity, reuseMediaFile } from './media-file-cache';
import { uploadMediaFile } from './upload-media-file';
import { preparePreviewVideo,probePreviewVideo,type PreviewVideoMetadata } from './preview-video';
import { runRenderWorker } from './render-worker';
import { importVideoLink } from './import-video-link';
import { prepareComposition,writeComposition } from './prepare-composition';
import { reviewComposition } from './review-composition';
import { extractInspectionFrames } from './inspect-video-frames';
import { MEDIA_ACTIVITY_LABELS, type MediaTaskActivity, type ReportMediaActivity } from '@/lib/media-analysis/activity';

export async function processMediaTask(task: MediaWorkItem, convex: ConvexHttpClient, convexUrl: string, signal: AbortSignal, onProgress: (percent: number) => void, onActivity?: ReportMediaActivity): Promise<MediaTaskResult> {
  const startedAt = Date.now();
  const logPhase = (phase: string, state: string, phaseStartedAt: number, detail = '') => {
    const now = Date.now();
    console.log(`[${new Date(now).toISOString()}] Media task ${task.taskId} (${task.kind}): ${phase} ${state}${detail ? ` · ${detail}` : ''} · phase ${((now - phaseStartedAt) / 1000).toFixed(1)}s · total ${((now - startedAt) / 1000).toFixed(1)}s · chat ${task.projectId}${task.aiRunId ? ` · run ${task.aiRunId}` : ''}`);
  };
  const runPhase = async <T>(phase: string, work: () => Promise<T>): Promise<T> => {
    const phaseStartedAt = Date.now();
    logPhase(phase, 'started', phaseStartedAt);
    const heartbeat=setInterval(()=>logPhase(phase,'still running',phaseStartedAt),15_000);
    try {
      const result = await work();
      logPhase(phase, 'complete', phaseStartedAt);
      return result;
    } catch (error) { logPhase(phase, 'failed', phaseStartedAt); throw error; }
    finally { clearInterval(heartbeat); }
  };
  let geminiActivity:MediaTaskActivity|undefined,geminiActivityStartedAt=0,geminiHeartbeat:ReturnType<typeof setInterval>|undefined;
  const reportGeminiActivity:ReportMediaActivity=(activity,diagnostic)=>{
    if(diagnostic)logPhase('Video evidence validation','rejected',geminiActivityStartedAt||startedAt,JSON.stringify(diagnostic));
    if(activity===geminiActivity)return;
    if(geminiActivity)logPhase(MEDIA_ACTIVITY_LABELS[geminiActivity],'complete',geminiActivityStartedAt);
    clearInterval(geminiHeartbeat);geminiActivity=activity;geminiActivityStartedAt=Date.now();
    onActivity?.(activity);logPhase(MEDIA_ACTIVITY_LABELS[activity],'started',geminiActivityStartedAt);
    geminiHeartbeat=setInterval(()=>logPhase(MEDIA_ACTIVITY_LABELS[activity],'still running',geminiActivityStartedAt),15_000);
  };
  const directory = await mkdtemp(join(tmpdir(), 'revline-task-'));
  const credentials = { taskId: task.taskId, leaseToken: task.leaseToken };
  const uploadContext = { convex, refreshAuth: async () => { signal.throwIfAborted(); } };
  try {
    if (task.kind === 'import') {
      if (task.outputAssetId) return {};
      if (!task.sourceUrl) throw new AnalysisError('The video link is missing.', 400);
      const { path, ...metadata } = await importVideoLink(task.sourceUrl, directory, signal, onProgress);
      await uploadMediaFile(path, { ...credentials, projectId: task.projectId, ...metadata, kind: 'video', contentType: 'video/mp4' }, uploadContext, signal);
      onProgress(98);
      return {};
    }
    if (task.kind === 'render') {
      if (!task.render || !task.renderJobId) throw new AnalysisError('Export snapshot is missing.', 400);
      if (task.outputStored) return {};
      const snapshot = task.render;
      onProgress(1);
      const assetUrls=await runPhase('Preparing export media',()=>prepareComposition(directory,snapshot.timeline,snapshot.assets as (MediaAsset & {size:number})[],convexUrl,signal));
      onProgress(3);
      await runPhase('Preparing export composition',()=>writeComposition(directory,snapshot.timeline,snapshot.assets as (MediaAsset & {size:number})[],assetUrls,snapshot.resolution as 720|1080,snapshot.fps as 24|30|60,'./',signal));
      const output = join(directory, 'video.mp4');
      await runPhase('Rendering export',()=>runRenderWorker(directory, output, { fps: snapshot.fps, quality: snapshot.quality as 'draft' | 'standard' | 'high' }, progress => onProgress(5+Math.round(progress.progress * .90)), signal));
      onProgress(97);
      await runPhase('Uploading export',()=>uploadMediaFile(output, { ...credentials, jobId: task.renderJobId, projectId: task.projectId, fileName: 'video.mp4', contentType: 'video/mp4', kind: 'video', duration: timelineDuration(snapshot.timeline), ...dimensions(snapshot.timeline.aspectRatio, snapshot.resolution) }, uploadContext, signal));
      return {};
    }
    if(task.kind==='review'){if(!task.review)throw new AnalysisError('Review snapshot is unavailable.',400);return {review:await reviewComposition(task.review,directory,convexUrl,signal,onProgress)};}
    const asset = task.asset;
    if (!asset?.url) throw new AnalysisError('The source media is unavailable.', 400);
    if(task.kind==='preview'&&asset.kind==='video'&&asset.previewVersion===1&&asset.previewR2Key&&[asset.previewSize,asset.previewWidth,asset.previewHeight,asset.previewFps].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>0))return {};
    if (task.kind === 'extract' && asset.audioExtracted) return asset.audioAssetId ? { audioAssetId: asset.audioAssetId } : {};
    if (task.kind === 'waveform' && asset.waveform) return { waveform: asset.waveform };
    if (task.kind === 'transcribe' && asset.analysis?.transcript && asset.analysis.audioActivity) return { analysis: { transcript: asset.analysis.transcript, audioActivity: asset.analysis.audioActivity } };
    if (task.kind === 'understand' && asset.analysis?.understanding) return { analysis: { understanding: asset.analysis.understanding } };
    const sourceAsset = task.kind === 'transcribe' ? task.transcriptionAsset ?? asset : asset;
    if (!sourceAsset.url) throw new AnalysisError('The prepared source media is unavailable.', 400);
    const source = join(directory, 'source'), sourceUrl = sourceAsset.url;
    const cacheIdentity = mediaSourceCacheIdentity(convexUrl, task.projectId, sourceAsset);
    const downloadStartedAt = Date.now();
    let loggedPercent = 0, loggedAt = downloadStartedAt;
    const reusedSource = await reuseMediaFile({ identity: cacheIdentity, variant: 'source-v1', target: source, signal, expectedBytes: sourceAsset.size }, () => {onActivity?.('downloading');return runPhase('Downloading source', () => downloadOwnedMedia(sourceUrl, source, new URL(convexUrl).origin, sourceAsset.size, signal, {
      concurrency: task.kind === 'extract' ? 3 : 1,
      onProgress: (bytes, total) => {
        const percent = Math.floor(bytes / total * 100), now = Date.now();
        onProgress(Math.round(bytes / total * (task.kind === 'extract' ? 45 : 10)));
        if (percent - loggedPercent < 10 && now - loggedAt < 5000 && percent < 100) return;
        const seconds = (now - downloadStartedAt) / 1000;
        const rate = seconds >= 1 ? bytes / seconds : 0;
        const measured = rate > 0 ? ` · ${(rate / 1048576).toFixed(1)} MiB/s · ~${Math.ceil((total - bytes) / rate)}s remaining` : '';
        logPhase('Downloading source', `${percent}%`, downloadStartedAt, `${(bytes / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MiB${measured}`);
        loggedPercent = percent; loggedAt = now;
      },
    }));});
    if (reusedSource) logPhase('Source cache', 'reused', downloadStartedAt);
    onProgress(task.kind === 'extract' ? 45 : 10);
    if (task.kind === 'extract') {
      const audioPath = join(directory, 'audio.m4a');
      const hasAudio = await runPhase('Extracting audio', () => extractSourceAudio(source, audioPath, signal));
      if (!hasAudio) return {};
      onProgress(60);
      let completedOutputs = 0;
      const outputReady = () => { onProgress(60 + ++completedOutputs * 19); };
      // Both operations only read the completed audio file. Wait for both on
      // failure as well so task cleanup cannot remove a file still uploading.
      const [waveformResult, uploadResult] = await Promise.allSettled([
        runPhase('Preparing waveform', () => measureAudioWaveform(audioPath, signal)).then(result => { outputReady(); return result; }),
        runPhase('Saving audio', () => task.outputAssetId ? Promise.resolve(task.outputAssetId) : uploadMediaFile(audioPath, { ...credentials, projectId: task.projectId, kind: 'audio', contentType: 'audio/mp4', fileName: `${asset.fileName.replace(/\.[^.]+$/, '').slice(0, 245)}.m4a`, ...(asset.duration ? { duration: asset.duration } : {}) }, uploadContext, signal)).then(result => { outputReady(); return result; }),
      ]);
      if (waveformResult.status === 'rejected') throw waveformResult.reason;
      if (uploadResult.status === 'rejected') throw uploadResult.reason;
      const waveform = waveformResult.value, audioAssetId = uploadResult.value;
      if (!audioAssetId) throw new Error('Could not store the extracted audio.');
      onProgress(98);
      return { audioAssetId, waveform };
    }
    if (task.kind === 'waveform') return { waveform: await measureAudioWaveform(source, signal) };
    if(task.kind==='preview'){
      if(asset.kind!=='video')throw new AnalysisError('Playback preview preparation needs a video source.',400);
      const output=join(directory,'preview.mp4');let metadata:PreviewVideoMetadata|undefined;
      const reused=await reuseMediaFile({identity:cacheIdentity,variant:'preview-v1',target:output,signal},()=>runPhase('Preparing playback preview',async()=>{metadata=await preparePreviewVideo(source,output,signal);}));
      if(reused)logPhase('Playback preview cache','reused',Date.now());
      metadata??=await probePreviewVideo(output,signal);onProgress(90);
      await runPhase('Saving playback preview',()=>uploadMediaFile(output,{...credentials,projectId:task.projectId,purpose:'preview',sourceAssetId:asset._id,previewVersion:1,previewFps:metadata!.fps,kind:'video',contentType:'video/mp4',fileName:`${asset.fileName.replace(/\.[^.]+$/,'').slice(0,230)}.preview.mp4`,duration:metadata!.duration,width:metadata!.width,height:metadata!.height},uploadContext,signal));
      onProgress(98);return {};
    }
    const media = await runPhase('Reading media information',()=>probeMedia(source, signal));
    if (task.kind === 'frames') {
      if (!media.hasVideo || !task.frameRequest) throw new AnalysisError('Frame inspection needs a video window and a question.', 400);
      const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!key) throw new AnalysisError('Gemini frame inspection is not configured on the media worker.', 503);
      onActivity?.('preparing-analysis');
      const { sourceFps, images,geometry } = await extractInspectionFrames(source, directory, task.frameRequest, media.duration, signal);
      onProgress(60);
      onActivity?.('analyzing');
      return { frameInspection: await runPhase('Inspecting frames',()=>inspectVideoFrames(images, sourceFps, task.frameRequest!, key, signal,geometry)) };
    }
    if (task.kind === 'transcribe') {
      if (!media.hasAudio) throw new AnalysisError('This source has no audio to transcribe.', 400);
      const savedTranscript = asset.analysis?.transcript;
      if (savedTranscript) return { analysis: { transcript: savedTranscript, audioActivity: await runPhase('Measuring quiet audio', () => measureAudioActivity(source, signal, savedTranscript)) } };
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new AnalysisError('OpenAI Whisper transcription is not configured on the media worker.', 503);
      const audio = join(directory, 'speech.mp3');
      await runPhase('Preparing transcription audio',()=>extractTranscriptionAudio(source, audio, signal));
      onProgress(30);
      const transcript = await runPhase('Transcribing speech',()=>transcribeWithWhisper(audio, asset.duration ?? media.duration, key, signal));
      return { analysis: { transcript, audioActivity: await runPhase('Measuring quiet audio', () => measureAudioActivity(source, signal, transcript)) } };
    }
    if (task.kind === 'beats') {
      if (!media.hasAudio) throw new AnalysisError('This source has no audio to measure.', 400);
      return { analysis: { beats: await runPhase('Detecting music beats',()=>detectMusicBeats(source, media.duration, signal)) } };
    }
    if (task.kind === 'track') return { analysis: { focus: await runPhase('Tracking subject',()=>trackSourceFace(source, media.duration, onProgress, signal)) } };
    if (task.kind === 'shots') return { analysis: { shots: await runPhase('Detecting shots',()=>detectShots(source, media.duration, signal)) } };
    if (!media.hasVideo) throw new AnalysisError('Footage understanding needs a video source.', 400);
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!key) throw new AnalysisError('Gemini agentic footage understanding is not configured on the media worker.', 503);
    const contentType = asset.contentType?.split(';')[0].trim().toLowerCase() ?? '';
    const mimeType = contentType === 'video/quicktime' ? 'video/mov' : contentType === 'video/x-msvideo' ? 'video/avi' : contentType;
    const nativeType = ['video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp'].includes(mimeType);
    const purpose = task.kind === 'video' ? 'inspection' : 'overview';
    let video = source, videoMimeType = mimeType;
    if (!nativeType || needsAnalysisVideoProxy(asset, media.duration, purpose)) {
      const prepared = join(directory, 'analysis.mp4'), preparationStartedAt = Date.now();
      onActivity?.('preparing-analysis');
      // Increment this variant if the corresponding prepareVideo profile changes.
      const reusedAnalysis = await reuseMediaFile({ identity: cacheIdentity, variant: `analysis-${purpose}-v1`, target: prepared, signal, ...(nativeType ? { maxBytes: asset.size - 1 } : {}) }, () => runPhase('Preparing analysis video',()=>prepareVideo(source, prepared, signal, purpose)));
      if (reusedAnalysis) logPhase('Analysis video cache', 'reused', preparationStartedAt, purpose);
      const preparedBytes = (await stat(prepared)).size;
      // An unusually simple source can already be smaller than the new encode.
      // Keep its native upload in that case; unsupported containers still need MP4.
      if (!nativeType || preparedBytes < asset.size) { video = prepared; videoMimeType = 'video/mp4'; }
      logPhase('Analysis video', video === prepared ? 'prepared' : 'using smaller original', preparationStartedAt, `${purpose} · ${(asset.size / 1048576).toFixed(1)} MiB source · ${(preparedBytes / 1048576).toFixed(1)} MiB copy`);
    }
    onProgress(30);
    if (task.kind === 'video') {
      if (!task.videoRequest) throw new AnalysisError('Native video inspection needs a question and source window.', 400);
      return { videoInspection: await runPhase('Inspecting video',()=>inspectVideo(video, media.duration, task.videoRequest!, key, signal, videoMimeType,reportGeminiActivity)) };
    }
    return { analysis: { understanding: await runPhase('Understanding footage',()=>understandVideo(video, media.duration, key, signal, videoMimeType,reportGeminiActivity,{projectId:task.projectId,taskId:task.taskId})) } };
  } finally { clearInterval(geminiHeartbeat);await rm(directory, { recursive: true, force: true }); }
}
