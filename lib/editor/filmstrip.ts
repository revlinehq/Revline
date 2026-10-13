export type FilmstripFrame = { index: number; left: number; time: number };

export function filmstripFrameWidth(height: number, width?: number, sourceHeight?: number) {
  const aspect = width && sourceHeight ? width / sourceHeight : 16 / 9;
  return Math.max(16, height * aspect);
}

/** Thumbnail positions follow source time, independent of where a clip is moved. */
export function filmstripFrames({ clipWidth, frameWidth, visibleStart, visibleEnd, pxPerSecond, sourceStart, duration, fps, sourceDuration, playbackRate = 1 }: {
  clipWidth: number; frameWidth: number; visibleStart: number; visibleEnd: number;
  pxPerSecond: number; sourceStart: number; duration: number; fps: number; sourceDuration?: number; playbackRate?: number;
}): FilmstripFrame[] {
  if (visibleEnd <= visibleStart || clipWidth <= 0) return [];
  const first = Math.max(0, Math.floor(visibleStart / frameWidth));
  const last = Math.min(Math.ceil(clipWidth / frameWidth) - 1, Math.floor(visibleEnd / frameWidth));
  const end = Math.min(sourceStart + duration * playbackRate, sourceDuration ?? Infinity);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => {
    const index = first + offset;
    const time = Math.min(Math.max(sourceStart, end - 1 / fps), sourceStart + index * frameWidth / pxPerSecond * playbackRate);
    return { index, left: index * frameWidth, time: Math.max(0, Math.floor((time + 1e-7) * fps) / fps) };
  });
}
