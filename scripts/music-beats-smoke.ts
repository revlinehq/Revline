import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectMusicBeats } from '../lib/media-analysis/music-beats';
import { addBeatMarkers } from '../lib/editor/beat-markers';
import { EMPTY_TIMELINE } from '../lib/editor/types';

const rate = 22050;
function wav(samples: Float32Array) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2));
  return bytes;
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-annotated-beats-'));
  try {
    const samples = new Float32Array(rate * 16);
    // Annotated120BPM groove: quiet offbeats, a sustained energy rise at8.5s,
    // and loud kicks once per second. Expected timestamps come from synthesis.
    for (let beat = 0; beat < 30; beat++) {
      const time = .5 + beat * .5;
      const amplitude = beat % 2 ? .015 : time < 8.5 ? .12 : .75;
      for (let i = 0; i < rate * .12; i++) {
        const index = Math.round(time * rate) + i;
        if (index >= samples.length) break;
        const t = i / rate;
        samples[index] += amplitude * Math.exp(-t * 45) * Math.sin(2 * Math.PI * (80 * t - 125 * t * t));
      }
    }
    for (let i = Math.round(8.5 * rate); i < samples.length; i++) {
      const t = i / rate;
      samples[i] += .12 * Math.sin(2 * Math.PI * 220 * t) + .09 * Math.sin(2 * Math.PI * 330 * t);
    }
    const source = join(directory, 'annotated-music.wav');
    await writeFile(source, wav(samples));
    const map = await detectMusicBeats(source, 16, AbortSignal.timeout(180_000));
    const accents = map.accents ?? [];
    const expectedHits = Array.from({ length: 7 }, (_, i) => 8.5 + i);
    assert.ok(expectedHits.every(time => map.accents?.some(hit => Math.abs(hit.time - time) < .03)), 'Loud annotated hits must be retrieved within30ms.');
    assert.ok(map.accents?.every(hit => expectedHits.some(time => Math.abs(hit.time - time) < .03)), 'Quiet offbeats must not become prominent-hit markers.');
    assert.ok(map.beats.length > accents.length && Math.abs(map.bpm - 120) <= 2, 'Musical pulse and audible hits must remain distinct.');
    assert.ok(map.dropCandidates?.some(hit => Math.abs(hit.time - 8.5) <= .2), 'Measured energy rise must be found near its annotated boundary.');
    const timeline = { ...EMPTY_TIMELINE, clips: [{ id: 'music', kind: 'audio' as const, start: 20, sourceStart: 8, duration: 4, playbackRate: 2 }] };
    const result = addBeatMarkers(timeline, 'music', map, { kind: 'accents' });
    assert.equal(result.added, expectedHits.length);
    assert.ok(result.timeline.markers?.every((marker, i) => Math.abs(marker.time - (20 + (expectedHits[i] - 8) / 2)) <= 1 / timeline.fps), 'Hit markers must follow source trims, clip placement and playback speed.');
    const silent = join(directory, 'silence.wav');
    await writeFile(silent, wav(new Float32Array(rate)));
    const silence = await detectMusicBeats(silent, 1, AbortSignal.timeout(30_000));
    assert.equal(silence.beats.length + (silence.accents?.length ?? 0) + (silence.dropCandidates?.length ?? 0), 0, 'Silence must not manufacture musical events.');
    console.log(JSON.stringify({ result: 'PASS', engine: map.engine, pulseCount: map.beats.length, hitCount: accents.length, annotatedHitToleranceMs: 30, candidateRise: 8.5, silentEvents: 0 }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Music tracking failed.'); process.exitCode = 1; });
