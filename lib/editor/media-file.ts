const mediaTypes: Readonly<Record<string, string>> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
};

/** Some OS file drops omit MIME metadata. Preserve explicit types; infer only missing generic ones. */
export function normalizeMediaFile(file: File): File | null {
  if (!file.size) return null;
  if (/^(video|audio|image)\//.test(file.type)) return file;
  if (file.type && file.type !== 'application/octet-stream') return null;
  const type = mediaTypes[file.name.split('.').at(-1)?.toLowerCase() ?? ''];
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : null;
}
