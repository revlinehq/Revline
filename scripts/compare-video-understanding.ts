import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvConfig } from '@next/env';
import { prepareVideo, probeMedia } from '../lib/media-analysis/io';
import { understandVideo as gemini } from '../lib/media-analysis/gemini';
import { understandVideo as twelvelabs } from '../lib/media-analysis/twelvelabs';

loadEnvConfig(process.cwd(), true);
const source = process.argv[2];
const output = process.argv[3] ?? '/tmp/revline-video-understanding-comparison.json';
assert.ok(source, 'Provide a local source video to compare.');
assert.ok(process.env.TWELVELABS_API_KEY && process.env.GOOGLE_GENERATIVE_AI_API_KEY, 'Configure both server-side analysis keys first.');

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-compare-'));
  try {
    const signal = AbortSignal.timeout(240_000);
    const { duration } = await probeMedia(source, signal);
    const proxy = join(directory, 'analysis.mp4');
    await prepareVideo(source, proxy, signal);
    const results: Record<string, unknown> = { source, duration };
    // Same proxy, prompt and validated output schema; no timeline mutations.
    for (const [provider, analyze, key] of [['twelvelabs', twelvelabs, process.env.TWELVELABS_API_KEY!], ['gemini', gemini, process.env.GOOGLE_GENERATIVE_AI_API_KEY!]] as const) {
      const started = performance.now();
      try {
        const understanding = await analyze(proxy, duration, key, AbortSignal.timeout(240_000));
        const seconds = Math.round((performance.now() - started) / 100) / 10;
        results[provider] = { seconds, understanding };
        console.log(`${provider}: ${understanding.scenes.length} validated scenes in ${seconds}s.`);
      } catch (error) {
        results[provider] = { error: error instanceof Error ? error.message : 'Analysis failed' };
        console.log(`${provider}: analysis failed; see the comparison artifact.`);
      }
      await writeFile(output, JSON.stringify(results, null, 2));
    }
    console.log(`Saved comparison: ${output}`);
    assert.ok((results.twelvelabs as { understanding?: unknown })?.understanding, 'TwelveLabs live analysis did not pass.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Comparison failed'); process.exitCode = 1; });
