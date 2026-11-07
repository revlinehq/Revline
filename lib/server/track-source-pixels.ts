import { pixelTrackPython } from './worker-tool-path';
import { localizeTrackingObject } from './localize-tracking-object';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { AnalysisError } from '../media-analysis/errors';
import { parsePixelTrackResult, pixelTrackRequest, pixelTrackMessage, type PixelTrackRequest, type PixelTrackChunk, type PixelTrackSummary, type pixelTrackHeader } from '../media-analysis/pixel-track';
import type { z } from 'zod';

type Sink = { header: (header: z.infer<typeof pixelTrackHeader>) => Promise<unknown>; chunk: (chunk: PixelTrackChunk) => Promise<unknown> };

/** Consume NDJSON with stream backpressure; neither runtime nor output size limits the shot. */
export async function trackSourcePixels(source: string, directory: string, request: PixelTrackRequest, signal: AbortSignal, sink: Sink): Promise<PixelTrackSummary> {
  const { segmenter, ...parsed } = pixelTrackRequest.parse(request);
  let input: PixelTrackRequest = parsed;
  let grounding: PixelTrackSummary['grounding'];
  if (input.seed.kind === 'object') {
    const localized = await localizeTrackingObject(source, directory, input.time, input.seed.noun, signal, segmenter);
    grounding = { ...localized, noun: input.seed.noun };
    input = pixelTrackRequest.parse({ ...input, time: localized.time, seed: { kind: 'box', box: localized.box } });
  }
  const python = pixelTrackPython();
  const child = spawn(python, [join(process.cwd(), 'scripts/track-pixels.py'), source, JSON.stringify(input)], { signal, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', spawnError: Error | undefined;
  child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-1000); });
  child.on('error', error => { spawnError = error; });
  const closed = new Promise<number | null>(resolve => child.once('close', code => resolve(code)));
  let result: PixelTrackSummary | undefined, headerSeen = false, count = 0;
  const sequence = { forward: 0, backward: 0 };
  try {
    let buffer = '';
    for await (const data of child.stdout) {
      buffer += Buffer.isBuffer(data) ? data.toString() : String(data);
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = pixelTrackMessage.parse(JSON.parse(line));
        if (message.type === 'header') { if (headerSeen) throw new Error('Duplicate tracker header.'); headerSeen = true; await sink.header(message.header); }
        else if (message.type === 'chunk') {
          const chunk = message.chunk;
          if (!headerSeen || chunk.sequence !== sequence[chunk.direction]++ || chunk.samples.some((sample, index) => sample.time < input.start - 1e-6 || sample.time >= input.end || index > 0 && (sample.frameIndex !== chunk.samples[index - 1].frameIndex + 1 || sample.time <= chunk.samples[index - 1].time))) throw new Error('Tracker returned an invalid frame chunk.');
          count += chunk.samples.length; await sink.chunk(chunk);
        } else {
          const parsed = parsePixelTrackResult(message.result, input);
          if (parsed.engine !== 'opencv-klt-template-v2' || parsed.sampleCount !== count) throw new Error('Tracker summary does not match its chunks.');
          result = parsed;
        }
      }
    }
    const code = await closed;
    signal.throwIfAborted();
    if (spawnError || code !== 0 || !result || buffer.trim()) throw new Error(spawnError?.message ?? (stderr || 'Tracking ended without a complete result.'));
    return { ...result, ...(grounding ? { grounding } : {}) };
  } catch (error) {
    child.kill('SIGTERM'); await closed;
    if (signal.aborted) throw error;
    throw new AnalysisError(`Pixel tracking failed. ${error instanceof Error ? error.message.slice(-1000) : String(error)}`, 502, false);
  }
}
