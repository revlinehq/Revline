import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AnalysisError } from '../../../../media-analysis/errors';
import { configuredFal, download, subscribe } from '../../../../server/fal';
import { ownedMediaUrl } from '../../../../server/owned-media';
import { pixelTrackPython } from '../../../../server/worker-tool-path';
import { BRIA_ERASE_ENDPOINT, BRIA_MASK_DILATE_PX, BRIA_MAX_SECONDS_PER_CALL, GENESIS_ALLOWANCE, GENESIS_REFUSAL, briaUsd } from '../render-contract';
import type { MediaWorkItem } from '@/convex/lib/media_task_contract';

type GenesisWork = NonNullable<MediaWorkItem['genesis']>;
type Outcome = { type: 'result'; report: Record<string, unknown> } | { type: 'fallback'; reason: string; report: Record<string, unknown> };
/** Counts the Bria seconds against the owner's monthly allowance, or throws the refusal. */
export type ReserveBria = (seconds: number, reason: string) => Promise<{ expectedUsd: number; plan: string; usedSeconds: number; monthlySeconds: number }>;

/** One compositor run (OpenCV, CPU). A refusal is a property of the footage: retrying cannot change it. */
async function compositor(request: Record<string, unknown>, signal: AbortSignal, onProgress: (value: number) => void): Promise<Outcome> {
  const child = spawn(pixelTrackPython(), [join(process.cwd(), 'lib/ai/lanes/genesis/worker/compositor.py'), JSON.stringify(request)], { signal, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', buffer = '', outcome: Outcome | undefined, refusal: string | undefined, spawnError: Error | undefined;
  child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-1500); });
  child.on('error', error => { spawnError = error; });
  const closed = new Promise<number | null>(resolve => child.once('close', code => resolve(code)));
  for await (const data of child.stdout) {
    buffer += String(data);
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as { type: string; value?: number; report?: Record<string, unknown>; message?: string; reason?: string };
      if (message.type === 'progress' && typeof message.value === 'number') onProgress(message.value);
      else if (message.type === 'result' && message.report) outcome = { type: 'result', report: message.report };
      else if (message.type === 'fallback' && message.reason) outcome = { type: 'fallback', reason: message.reason, report: message.report ?? {} };
      else if (message.type === 'refusal') refusal = message.message;
    }
  }
  const code = await closed;
  signal.throwIfAborted();
  if (refusal) throw new AnalysisError(`${GENESIS_REFUSAL}${refusal}`, 422, false);
  if (spawnError || !outcome || (code !== 0 && outcome.type !== 'fallback')) throw new AnalysisError(`The Genesis compositor failed. ${spawnError?.message ?? stderr.slice(-600)}`, 502, false);
  return outcome;
}

const erased = z.object({ video: z.object({ url: z.string().url() }) });

/** Run a Genesis render on a downloaded source: the free compositor first; for a clean plate it cannot make
 * (moving camera, masked pixels never uncovered), Bria Video Eraser in ≤5 s chunks, within the monthly allowance. */
export async function renderGenesis(source: string, directory: string, work: GenesisWork, convexOrigin: string, reserve: ReserveBria, signal: AbortSignal, onProgress: (value: number) => void) {
  const output = join(directory, work.op === 'cleanPlate' ? 'genesis-clean-plate.mp4' : 'genesis-surface.webm');
  const media = (url: string) => ownedMediaUrl(url, convexOrigin);
  const params = (work.params ?? {}) as Record<string, unknown>;
  const base = {
    source, start: work.start, end: work.end, fps: work.fps, masks: work.masks.map(media),
    ...(work.seedMask ? { seedMask: media(work.seedMask) } : {}),
    ...(work.insert ? { insert: media(work.insert.url), insertKind: work.insert.kind } : {}),
  };
  const contentType = work.op === 'cleanPlate' ? 'video/mp4' : 'video/webm';
  const free = await compositor({ ...base, ...params, op: work.op, output, fallback: params.fallback ?? 'bria' }, signal, value => onProgress(10 + Math.round(value * (work.op === 'cleanPlate' ? .3 : .85))));
  if (free.type === 'result') return { path: output, report: { ...free.report, method: work.op === 'cleanPlate' ? 'cleanPlate' : 'surface', costUsd: 0 }, contentType, width: Number(free.report.width), height: Number(free.report.height) };

  // Paid fallback: reserve the seconds first (refuses past the allowance), then erase chunk by chunk and join.
  const seconds = Math.round((work.end - work.start) * 1000) / 1000, fal = configuredFal();
  if (!fal) throw new AnalysisError(`${free.reason} The paid eraser is not configured on this media worker (FAL_KEY), so nothing was charged.`, 503, false);
  let allowance: Awaited<ReturnType<ReserveBria>>;
  try { allowance = await reserve(seconds, free.reason); }
  catch (error) {
    const data = (error as { data?: unknown }).data, message = typeof data === 'string' ? data : error instanceof Error ? error.message : String(error);
    const prefix = [GENESIS_REFUSAL, GENESIS_ALLOWANCE].find(item => message.includes(item));
    throw new AnalysisError(prefix ? message.slice(message.indexOf(prefix)) : `Could not reserve the paid eraser: ${message}`, 422, false);
  }
  const prep = await compositor({ ...base, op: 'erasePrep', outDir: directory, chunkSeconds: BRIA_MAX_SECONDS_PER_CALL, dilatePx: BRIA_MASK_DILATE_PX }, signal, value => onProgress(40 + Math.round(value * .05)));
  if (prep.type !== 'result') throw new AnalysisError('The eraser chunks could not be prepared.', 502, false);
  const chunks = z.array(z.object({ source: z.string(), mask: z.string(), frames: z.number(), seconds: z.number() })).parse(prep.report.chunks);
  console.log(`[genesis] Bria Video Eraser (mask mode): ${chunks.length} call(s), ${seconds.toFixed(2)} s, expected $${allowance.expectedUsd.toFixed(2)} at $0.14/s. ${free.reason} Allowance after: ${allowance.usedSeconds}/${allowance.monthlySeconds} s (${allowance.plan}).`);
  const started = Date.now(), done: { path: string; frames: number }[] = [];
  for (const [index, chunk] of chunks.entries()) {
    console.log(`[genesis] Bria call ${index + 1}/${chunks.length}: ${chunk.seconds.toFixed(2)} s, expected $${briaUsd(chunk.seconds).toFixed(2)}.`);
    const upload = async (path: string) => fal.storage.upload(new Blob([await readFile(path)], { type: 'video/mp4' }));
    const [video_url, mask_video_url] = await Promise.all([upload(chunk.source), upload(chunk.mask)]);
    let result;
    // Never retried automatically: a retry would pay again. A new call starts a fresh, counted render.
    try { result = erased.parse(await subscribe(fal, BRIA_ERASE_ENDPOINT, { video_url, mask_video_url, output_container_and_codec: 'mp4_h264' }, signal)); }
    catch (error) { if (signal.aborted) throw error; throw new AnalysisError(`The paid eraser failed on chunk ${index + 1}: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`, 502, false); }
    const path = join(directory, `erase-${index}-result.mp4`);
    await download(result.video.url, path, signal);
    done.push({ path, frames: chunk.frames });
    onProgress(45 + Math.round((index + 1) / chunks.length * 40));
  }
  const joined = await compositor({ ...base, op: 'eraseJoin', output, chunks: done, dilatePx: BRIA_MASK_DILATE_PX }, signal, value => onProgress(85 + Math.round(value * .1)));
  if (joined.type !== 'result') throw new AnalysisError('The erased chunks could not be joined.', 502, false);
  const report = { ...free.report, ...joined.report, method: 'bria', reason: free.reason, provider: `fal ${BRIA_ERASE_ENDPOINT}`, calls: chunks.length, briaSeconds: seconds, costUsd: allowance.expectedUsd, eraseSeconds: Math.round((Date.now() - started) / 100) / 10, maskDilatePx: prep.report.dilatePx, allowance: { plan: allowance.plan, usedSeconds: allowance.usedSeconds, monthlySeconds: allowance.monthlySeconds } };
  return { path: output, report, contentType, width: Number(joined.report.width), height: Number(joined.report.height) };
}
