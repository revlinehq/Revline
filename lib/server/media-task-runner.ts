import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { ConvexHttpClient } from 'convex/browser';
import type { MediaWorkItem, MediaTaskResult } from '@/convex/mediaTasks';
import { generateComposition } from '@/lib/editor/composition';
import { dimensions, timelineDuration, type MediaAsset } from '@/lib/editor/types';
import { downloadOwnedMedia, extractTranscriptionAudio, prepareVideo, probeMedia } from '@/lib/media-analysis/io';
import { inspectVideo, inspectVideoFrames, understandVideo } from '@/lib/media-analysis/gemini';
import { transcribeWithWhisper } from '@/lib/media-analysis/whisper';
import { detectShots } from '@/lib/media-analysis/detect-shots';
import { detectMusicBeats } from '@/lib/media-analysis/music-beats';
import { AnalysisError } from '@/lib/media-analysis/errors';
import { trackSourceFace } from './track-source-face';
import { extractSourceAudio } from './extract-audio';
import { measureAudioWaveform } from './audio-waveform';
import { uploadMediaFile } from './upload-media-file';
import { runRenderWorker } from './render-worker';
import { importVideoLink } from './import-video-link';
import { extractInspectionFrames } from './inspect-video-frames';

export async function processMediaTask(task: MediaWorkItem, convex: ConvexHttpClient, convexUrl: string, signal: AbortSignal, onProgress: (percent: number) => void): Promise<MediaTaskResult> {
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
      const assetUrls: Record<string, string> = {};
      for (const [index, asset] of snapshot.assets.entries()) {
        if (!asset.url) throw new AnalysisError('Export source media is unavailable.', 400);
        const sourceExtension = extname(asset.fileName).toLowerCase();
        const extension = /^\.(mp4|mov|webm|m4v|mp3|wav|m4a|ogg|flac|aac|aiff|png|jpg|jpeg|webp|gif|avif)$/.test(sourceExtension) ? sourceExtension : asset.kind === 'video' ? '.mp4' : asset.kind === 'audio' ? '.audio' : '.image';
        const name = `asset-${index}${extension}`;
        await downloadOwnedMedia(asset.url, join(directory, name), new URL(convexUrl).origin, asset.size, signal);
        assetUrls[asset._id] = `./${name}`;
      }
      await copyFile(join(process.cwd(), 'public/vendor/gsap.min.js'), join(directory, 'gsap.min.js'));
      await copyFile(join(process.cwd(), 'public/vendor/visual-effects.js'), join(directory, 'visual-effects.js'));
      await copyFile(join(process.cwd(), 'public/vendor/remotion-text.js'), join(directory, 'remotion-text.js'));
      await copyFile(join(process.cwd(), 'public/fonts/space-grotesk-latin.woff2'), join(directory, 'space-grotesk-latin.woff2'));
      await writeFile(join(directory, 'index.html'), generateComposition(snapshot.timeline, snapshot.assets as MediaAsset[], { resolution: snapshot.resolution as 720 | 1080, fps: snapshot.fps as 24 | 30 | 60, gsapUrl: './gsap.min.js', visualEffectsUrl: './visual-effects.js', remotionTextUrl: './remotion-text.js', fontUrl: './space-grotesk-latin.woff2', assetUrls }));
      const output = join(directory, 'video.mp4');
      await runRenderWorker(directory, output, { fps: snapshot.fps, quality: snapshot.quality as 'draft' | 'standard' | 'high' }, progress => onProgress(Math.round(progress.progress * .95)), signal);
      onProgress(97);
      await uploadMediaFile(output, { ...credentials, jobId: task.renderJobId, projectId: task.projectId, fileName: 'video.mp4', contentType: 'video/mp4', kind: 'video', duration: timelineDuration(snapshot.timeline), ...dimensions(snapshot.timeline.aspectRatio, snapshot.resolution) }, uploadContext, signal);
      return {};
    }
    const asset = task.asset;
    if (!asset?.url) throw new AnalysisError('The source media is unavailable.', 400);
    if (task.kind === 'extract' && asset.audioExtracted) return asset.audioAssetId ? { audioAssetId: asset.audioAssetId } : {};
    if (task.kind === 'waveform' && asset.waveform) return { waveform: asset.waveform };
    if (task.kind === 'transcribe' && asset.analysis?.transcript) return { analysis: { transcript: asset.analysis.transcript } };
    const source = join(directory, 'source');
    await downloadOwnedMedia(asset.url, source, new URL(convexUrl).origin, asset.size, signal);
    onProgress(10);
    if (task.kind === 'extract') {
      const audioPath = join(directory, 'audio.m4a');
      const hasAudio = await extractSourceAudio(source, audioPath, signal);
      if (!hasAudio) return {};
      const waveform = await measureAudioWaveform(audioPath, signal);
      onProgress(75);
      const audioAssetId = task.outputAssetId ?? await uploadMediaFile(audioPath, { ...credentials, projectId: task.projectId, kind: 'audio', contentType: 'audio/mp4', fileName: `${asset.fileName.replace(/\.[^.]+$/, '').slice(0, 245)}.m4a`, ...(asset.duration ? { duration: asset.duration } : {}) }, uploadContext, signal);
      if (!audioAssetId) throw new Error('Could not store the extracted audio.');
      return { audioAssetId, waveform };
    }
    if (task.kind === 'waveform') return { waveform: await measureAudioWaveform(source, signal) };
    const media = await probeMedia(source, signal);
    if (task.kind === 'frames') {
      if (!media.hasVideo || !task.frameRequest) throw new AnalysisError('Frame inspection needs a video window and a question.', 400);
      const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!key) throw new AnalysisError('Gemini frame inspection is not configured on the media worker.', 503);
      const { sourceFps, images } = await extractInspectionFrames(source, directory, task.frameRequest, media.duration, signal);
      onProgress(60);
      return { frameInspection: await inspectVideoFrames(images, sourceFps, task.frameRequest, key, signal) };
    }
    if (task.kind === 'transcribe') {
      if (!media.hasAudio) throw new AnalysisError('This source has no audio to transcribe.', 400);
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new AnalysisError('OpenAI Whisper transcription is not configured on the media worker.', 503);
      const audio = join(directory, 'speech.mp3');
      await extractTranscriptionAudio(source, audio, signal);
      onProgress(30);
      return { analysis: { transcript: await transcribeWithWhisper(audio, media.duration, key, signal) } };
    }
    if (task.kind === 'beats') {
      if (!media.hasAudio) throw new AnalysisError('This source has no audio to measure.', 400);
      return { analysis: { beats: await detectMusicBeats(source, media.duration, signal) } };
    }
    if (task.kind === 'track') return { analysis: { focus: await trackSourceFace(source, media.duration, onProgress, signal) } };
    if (task.kind === 'shots') return { analysis: { shots: await detectShots(source, media.duration, signal) } };
    if (!media.hasVideo) throw new AnalysisError('Footage understanding needs a video source.', 400);
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!key) throw new AnalysisError('Gemini agentic footage understanding is not configured on the media worker.', 503);
    const contentType = asset.contentType?.split(';')[0].trim().toLowerCase() ?? '';
    const mimeType = contentType === 'video/quicktime' ? 'video/mov' : contentType === 'video/x-msvideo' ? 'video/avi' : contentType;
    const nativeType = ['video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp'].includes(mimeType);
    // Pass supported source files intact so fast action retains its recorded frames.
    // Unknown containers get a playable MP4 without imposing a sampling rate.
    const video = nativeType ? source : join(directory, 'analysis.mp4');
    if (!nativeType) await prepareVideo(source, video, signal);
    onProgress(30);
    if (task.kind === 'video') {
      if (!task.videoRequest) throw new AnalysisError('Native video inspection needs a question and source window.', 400);
      return { videoInspection: await inspectVideo(video, media.duration, task.videoRequest, key, signal, nativeType ? mimeType : 'video/mp4') };
    }
    return { analysis: { understanding: await understandVideo(video, media.duration, key, signal, nativeType ? mimeType : 'video/mp4') } };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
