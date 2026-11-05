import { spawn } from 'node:child_process';
import { paddedPreviewRanges } from '../editor/preview-segments';
import type { SourceRange } from '../editor/types';

/** Boundaries land on source frames, including VFR, so a segment never shows the next frame early. */
export async function previewChunkBoundaries(
  input: string,
  source: { duration: number; origin: number },
  signal: AbortSignal,
  ranges: SourceRange[] = [],
) {
  const targets = [
    ...new Set([
      0,
      ...Array.from({ length: Math.ceil(source.duration / 30) }, (_, index) => index * 30),
      ...paddedPreviewRanges(source.duration, ranges).flatMap((range) => [range.start, range.end]),
    ]),
  ]
    .filter((value) => value < source.duration)
    .sort((a, b) => a - b);
  const firstInBucket = new Map<number, number>();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_packets',
        '-show_entries',
        'packet=pts_time',
        '-of',
        'csv=p=0',
        input,
      ],
      { signal, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let pending = '',
      stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      pending += data;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const time = Number.parseFloat(line) - source.origin;
        if (!Number.isFinite(time) || time <= 0 || time >= source.duration) continue;
        let low = 0,
          high = targets.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (targets[middle] <= time) low = middle + 1;
          else high = middle;
        }
        const bucket = low - 1;
        if (bucket > 0 && time < (firstInBucket.get(bucket) ?? Infinity)) firstInBucket.set(bucket, time);
      }
    });
    child.stderr.on('data', (data: string) => {
      stderr = (stderr + data).slice(-4096);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Could not read source frame boundaries: ${stderr}`)),
    );
  });
  return [0, ...[...firstInBucket.values()].sort((a, b) => a - b)];
}
