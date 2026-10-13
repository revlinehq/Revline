import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { ConvexHttpClient } from 'convex/browser';
import type { MediaWorkItem, MediaTaskResult } from '@/convex/mediaTasks';
import { generateComposition } from '@/lib/editor/composition';
import { dimensions, timelineDuration, type MediaAsset } from '@/lib/editor/types';
import { downloadOwnedMedia, extractPcm, extractSpeechAudio, prepareVideo, probeMedia } from '@/lib/media-analysis/io';
import { inspectVideoFrames, transcribeAudio } from '@/lib/media-analysis/gemini';
import { understandVideo } from '@/lib/media-analysis/twelvelabs';
import { detectShots } from '@/lib/media-analysis/detect-shots';
import { detectBeats } from '@/lib/media-analysis/beats';
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
      await copyFile(join(process.cwd(), 'public/fonts/space-grotesk-latin.woff2'), join(directory, 'space-grotesk-latin.woff2'));
      await writeFile(join(directory, 'index.html'), generateComposition(snapshot.timeline, snapshot.assets as MediaAsset[], { resolution: snapshot.resolution as 720 | 1080, fps: snapshot.fps as 24 | 30 | 60, gsapUrl: './gsap.min.js', fontUrl: './space-grotesk-latin.woff2', assetUrls }));
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
      const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!key) throw new AnalysisError('Gemini transcription is not configured on the media worker.', 503);
      const audio = join(directory, 'speech.wav');
      await extractSpeechAudio(source, audio, signal); onProgress(30);
      return { analysis: { transcript: await transcribeAudio(audio, media.duration, key, signal) } };
    }
    if (task.kind === 'beats') {
      if (!media.hasAudio) throw new AnalysisError('This source has no audio to measure.', 400);
      return { analysis: { beats: detectBeats(await extractPcm(source, signal), 16_000) } };
    }
    if (task.kind === 'track') return { analysis: { focus: await trackSourceFace(source, media.duration, onProgress, signal) } };
    const shots = asset.analysis?.shots ?? await detectShots(source, media.duration, signal);
    if (task.kind === 'shots') return { analysis: { shots } };
    const key = process.env.TWELVELABS_API_KEY;
    if (!key) throw new AnalysisError('TwelveLabs footage understanding is not configured on the media worker.', 503);
    const video = join(directory, 'analysis.mp4');
    await prepareVideo(source, video, signal); onProgress(30);
    return { analysis: { shots, understanding: await understandVideo(video, media.duration, key, signal) } };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
