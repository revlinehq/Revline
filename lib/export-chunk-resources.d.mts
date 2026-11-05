export const EXPORT_CHUNK_GUEST: Readonly<{ cpu_kind: 'performance'; cpus: 4; memory_mb: 8192 }>;

export const EXPORT_CHUNK_CPU_ENV: Readonly<{
  REVLINE_RENDER_WORKERS: '2';
  REVLINE_RENDER_FFMPEG_SLOTS: '2';
  REVLINE_RENDER_ENCODE_THREADS: '4';
  MEDIA_PROCESSOR_THREADS: '4';
  MEDIA_PREVIEW_CPUS: '4';
}>;

export const EXPORT_CHUNK_NATIVE_ENV: typeof EXPORT_CHUNK_CPU_ENV & Readonly<{
  BEAT_TRACK_THREADS: '4';
  OMP_NUM_THREADS: '4';
  MKL_NUM_THREADS: '4';
  OMP_THREAD_LIMIT: '4';
}>;


export function exportChunkResources(settings: { guest?: unknown; env?: unknown }): {
  chunkGuest: { cpu_kind: 'performance' | 'shared'; cpus: number; memory_mb: number };
  chunkEnv: Record<string, string>;
};
