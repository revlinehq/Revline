type OpeningFootage = { projectId: string; thumbnail?: string; fileName?: string; ownsThumbnail: boolean };
let current: OpeningFootage | undefined;

/** Carry one small poster across the upload-to-editor SPA transition, without a second download. */
export function rememberOpeningFootage(projectId: string, poster?: Blob | string, fileName?: string) {
  if (current?.ownsThumbnail && current.thumbnail) URL.revokeObjectURL(current.thumbnail);
  const ownsThumbnail = poster instanceof Blob;
  current = { projectId, thumbnail: ownsThumbnail ? URL.createObjectURL(poster) : poster, fileName, ownsThumbnail };
}
export function openingFootage(projectId?: string) { return current?.projectId === projectId ? current : undefined; }
export function releaseOpeningFootage(projectId?: string) {
  if (current?.projectId !== projectId) return;
  if (current?.ownsThumbnail && current.thumbnail) URL.revokeObjectURL(current.thumbnail);
  current = undefined;
}
