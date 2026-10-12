import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { extractSourceAudio } from './extract-audio';
const run = promisify(execFile);
it('extracts real audio, preserves AAC packets, handles silent video and converts PCM', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'revline-audio-test-'));
  try {
    const video = join(dir, 'video.mp4'), audio = join(dir, 'audio.m4a'), silent = join(dir, 'silent.mp4'), pcm = join(dir, 'pcm.wav'), converted = join(dir, 'converted.m4a');
    await run('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-c:a','aac','-y',video]);
    expect(await extractSourceAudio(video, audio, AbortSignal.timeout(10000))).toBe(true);
    await run('ffmpeg', ['-v','error','-i',video,'-map','0:a:0','-c:a','copy','-f','adts','-y',join(dir,'original.aac')]);
    await run('ffmpeg', ['-v','error','-i',audio,'-c:a','copy','-f','adts','-y',join(dir,'separated.aac')]);
    expect(await readFile(join(dir,'separated.aac'))).toEqual(await readFile(join(dir,'original.aac')));
    await run('ffmpeg', ['-v','error','-i',video,'-an','-c:v','copy','-y',silent]);
    expect(await extractSourceAudio(silent, join(dir,'none.m4a'), AbortSignal.timeout(10000))).toBe(false);
    await run('ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','1','-y',pcm]);
    expect(await extractSourceAudio(pcm, converted, AbortSignal.timeout(10000))).toBe(true);
    const { stdout } = await run('ffprobe', ['-v','error','-show_entries','stream=codec_name,codec_type','-of','json',converted]);
    expect(JSON.parse(stdout).streams).toEqual([expect.objectContaining({ codec_name: 'aac', codec_type: 'audio' })]);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 20000);
