import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { inspectVideo, understandVideo } from '../lib/media-analysis/gemini';
import { videoMatchesOnClip } from '../lib/media-analysis/video-inspection';

const run = promisify(execFile);
async function main() {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  assert.ok(key, 'Configure the server-side Gemini key to run this generated-video check.');
  // Use the requested ID without touching a private environment file. Google may route the deprecated 3.7 ID to 3.8.
  process.env.GEMINI_VIDEO_MODEL = 'gemini-3.7-flash';
  const directory = await mkdtemp(join(tmpdir(), 'revline-agentic-smoke-'));
  const originalFetch = globalThis.fetch;
  type ProcessingEvidence = { requestedModel: string; returnedModel?: unknown; processing?: unknown; processingCalls?: number; processingResults?: number };
  const interactions: ProcessingEvidence[] = [];
  let phase = 'overview';
  globalThis.fetch = async (input, options) => {
    const response = await originalFetch(input, options);
    if (String(input).endsWith('/interactions')) {
      const request = JSON.parse(String(options?.body));
      const evidence: ProcessingEvidence = { requestedModel: request.model, processing: request.input.find((part: { type: string }) => part.type === 'video')?.processing };
      if (response.ok) {
        const result = await response.clone().json() as { model?: unknown; steps?: { type?: string }[] };
        evidence.returnedModel = result.model;
        evidence.processingCalls = result.steps?.filter(step => step.type === 'processing_call').length ?? 0;
        evidence.processingResults = result.steps?.filter(step => step.type === 'processing_result').length ?? 0;
      } else {
        const result = await response.clone().json() as { error?: { message?: string } };
        throw new Error(`${phase} failed (HTTP ${response.status}): ${result.error?.message?.slice(0, 1500) ?? 'Provider rejected this generated-media request.'}`);
      }
      interactions.push(evidence);
    }
    return response;
  };
  try {
    const source = join(directory, 'color-change.mp4');
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
    const result = await understandVideo(source, 4, key, AbortSignal.timeout(180_000));
    assert.ok(result.scenes.every(scene => scene.start >= 0 && scene.end <= 4 && scene.end > scene.start));
    const description = [result.summary, ...result.scenes.map(scene => scene.description)].join(' ').toLowerCase();
    assert.ok(description.includes('red') && description.includes('blue'), 'The model must identify the generated source colors.');
    assert.ok(result.scenes.some(scene => Math.abs(scene.start - 2) <= .5 || Math.abs(scene.end - 2) <= .5), 'The source color change is at 2 seconds; scene timestamps must identify that vicinity.');
    phase = 'blue question';
    const blue = await inspectVideo(source, 4, { start: 1, end: 3, question: 'Find the interval where the screen is solid blue within the requested source window. Exclude red.' }, key, AbortSignal.timeout(180_000));
    assert.ok(blue.matches.length > 0, 'The requested window contains a blue segment.');
    assert.ok(blue.matches.every(match => match.start >= 2 && match.end <= 3 && match.end > match.start), 'Blue is visible only from 2 to 3 seconds in the requested window.');
    assert.ok(blue.matches.some(match => Math.abs(match.start - 2) <= .1 && Math.abs(match.end - 3) <= .1), 'The matching window should include the observed blue interval.');
    phase = 'green question';
    const green = await inspectVideo(source, 4, { start: 0, end: 4, question: 'Find intervals where the screen is solid green. If no green is visible, return no matches.' }, key, AbortSignal.timeout(180_000));
    assert.deepEqual(green.matches, [], 'This generated source contains no green.');
    const mapped = videoMatchesOnClip(blue, { id: 'smoke-trimmed-clip', kind: 'video', start: 10, sourceStart: 2.5, duration: .25, playbackRate: 2 });
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].sourceStart, 2.5); assert.equal(mapped[0].sourceEnd, 3);
    assert.equal(mapped[0].timelineStart, 10); assert.equal(mapped[0].timelineEnd, 10.25);
    assert.equal(interactions.length, 3);
    for (const evidence of interactions) {
      assert.equal(evidence.requestedModel, 'gemini-3.7-flash');
      assert.equal(evidence.processing, 'agentic');
      assert.ok((evidence.processingCalls ?? 0) > 0 && (evidence.processingResults ?? 0) > 0, 'Every provider response must confirm native agentic processing steps.');
    }
    console.log(JSON.stringify({ result: 'PASS', interactions, duration: 4, scenes: result.scenes, blue, green, mapped, timelineMutations: 0 }));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => {
  console.error(JSON.stringify({ result: 'FAIL', message: error instanceof Error ? error.message : 'Agentic video check failed' }));
  process.exitCode = 1;
});
