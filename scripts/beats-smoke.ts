import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectBeats } from '../lib/media-analysis/beats';
import { extractPcm, extractSpeechAudio, probeMedia } from '../lib/media-analysis/io';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-beats-test-'));
  const signal = AbortSignal.timeout(30_000);
  try {
    const raw = join(directory, 'clicks.f32');
    const media = join(directory, 'clicks.mp4');
    const speech = join(directory, 'speech.wav');
    const sampleRate = 44_100;
    const source = Buffer.alloc(sampleRate * 6 * 4);
    const times: number[] = [];
    for (let time = 0.25; time < 5.9; time += 0.5) {
      times.push(time);
      const start = Math.round(time * sampleRate);
      for (let sample = 0; sample < 2000; sample++) source.writeFloatLE(Math.sin(sample / sampleRate * 2 * Math.PI * 1000) * Math.exp(-sample / 330), (start + sample) * 4);
    }
    await writeFile(raw, source);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-i', raw, '-f', 'lavfi', '-i', 'color=c=black:s=128x128:r=24:d=6', '-map', '1:v', '-map', '0:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', media]);
    const probe = await probeMedia(media, signal);
    assert.equal(probe.hasAudio, true);
    assert.equal(probe.hasVideo, true);
    const pcm = await extractPcm(media, signal);
    const result = detectBeats(pcm, 16_000);
    assert.ok(Math.abs(result.bpm - 120) <= 2, `Detected ${result.bpm} BPM`);
    assert.ok(result.confidence > 0.5);
    assert.equal(result.beats.length, times.length);
    result.beats.forEach((beat, index) => assert.ok(Math.abs(beat - times[index]) < 0.04));
    await extractSpeechAudio(media, speech, signal);
    const audioProbe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,codec_name', '-of', 'json', speech], { encoding: 'utf8' }));
    assert.equal(audioProbe.streams[0].sample_rate, '16000');
    assert.equal(audioProbe.streams[0].channels, 1);
    assert.equal(audioProbe.streams[0].codec_name, 'pcm_s16le');
    console.log(`Media analysis integration passed: AAC video -> real mono 16 kHz PCM, ${result.bpm} BPM, ${result.beats.length} accurate source beats, transcription WAV extraction.`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
