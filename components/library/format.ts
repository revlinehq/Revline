export function formatBytes(bytes: number) {
  if (bytes === 0) return '0 GB';
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Number((bytes / 1_000_000_000).toFixed(1))} GB`;
}
/** 0:48, 3:12, 1:42:08. */
export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds)), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
export const shortDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const longDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
export const KIND_LABELS = { video: 'Video', audio: 'Audio', image: 'Image', model: 'Model', export: 'Export' } as const;
const NAMED_RATIOS: [number, number][] = [[16, 9], [9, 16], [1, 1], [4, 3], [3, 4], [4, 5], [5, 4], [3, 2], [2, 3], [21, 9], [9, 21]];
/** 1920×1080 · 16:9. A near-standard shape takes its usual name; any other reads as its reduced ratio or 2.17:1. */
export function formatDimensions(width: number, height: number) {
  const ratio = width / height, named = NAMED_RATIOS.find(([w, h]) => Math.abs(w / h / ratio - 1) < 0.01);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a, divisor = gcd(width, height);
  const label = named ? `${named[0]}:${named[1]}` : width / divisor <= 32 && height / divisor <= 32 ? `${width / divisor}:${height / divisor}` : ratio >= 1 ? `${Number(ratio.toFixed(2))}:1` : `1:${Number((1 / ratio).toFixed(2))}`;
  return `${width}×${height} · ${label}`;
}
