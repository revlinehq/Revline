import { spawn } from 'node:child_process';

export type PreviewRange = { start: number; end: number };

/** Snap thirty-second splits to real presentation timestamps, including VFR. */
export async function previewChunkRanges(input: string, duration: number, origin: number, signal: AbortSignal): Promise<PreviewRange[]> {
  const starts = new Map<number, number>();
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_packets', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', input], { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      pending += data;
      const lines = pending.split('\n'); pending = lines.pop() ?? '';
      for (const line of lines) {
        const time = Number.parseFloat(line) - origin, bucket = Math.floor(time / 30);
        if (Number.isFinite(time) && bucket > 0 && time < duration && time < (starts.get(bucket) ?? Infinity)) starts.set(bucket, time);
      }
    });
    child.stderr.on('data', (data: string) => { stderr = (stderr + data).slice(-4096); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Could not read preview frame boundaries: ${stderr}`)));
  });
  const boundaries = [0, ...[...starts.values()].sort((a, b) => a - b)];
  return boundaries.map((start, index) => ({ start, end: boundaries[index + 1] ?? duration }));
}
