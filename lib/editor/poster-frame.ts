/** Where every stored video poster is taken: one second in (half of a shorter clip), past the black first frame and
 *  most fade-ins. Uploads (project and Library), the Library's own backfill and the media processor all use it. */
export function posterTime(duration: number | undefined) {
  return Number.isFinite(duration) && duration! > 0 ? Math.min(1, duration! / 2) : 0;
}

/** The longest side of a stored poster, and its JPEG quality: small enough to load at once in a grid. */
const POSTER_SIZE = 352, POSTER_QUALITY = .7;
/** The largest poster Convex accepts (`assets.attachThumbnail`, `playback.attachPoster`, `library.saveThumbnail`). */
export const POSTER_MAX_BYTES = 128 * 1024;

/** Draws the video's current frame into `canvas` at poster size. False when the video has no picture yet. */
export function drawPoster(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  if (!video.videoWidth || !video.videoHeight) return false;
  const scale = Math.min(POSTER_SIZE / video.videoWidth, POSTER_SIZE / video.videoHeight, 1);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return true;
}

/** The poster JPEG of a drawn canvas; null when the frame came from another origin without CORS, or is too large. */
export function posterBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>(resolve => {
    try { canvas.toBlob(blob => resolve(blob && blob.size <= POSTER_MAX_BYTES ? blob : null), 'image/jpeg', POSTER_QUALITY); }
    catch { resolve(null); }
  });
}

/** Seeks a loaded video to its poster time. Resolves true once that frame shows, or false when the seek did not finish
 *  within `timeout`: the video then keeps the frame it has, which is fine to show but not to store. */
export function seekToPoster(video: HTMLVideoElement, timeout = 4000) {
  const time = posterTime(video.duration);
  if (!time || Math.abs(video.currentTime - time) < .001) return Promise.resolve(true);
  return new Promise<boolean>(resolve => {
    const done = (reached: boolean) => () => { clearTimeout(timer); video.removeEventListener('seeked', seeked); resolve(reached); };
    const seeked = done(true), timer = setTimeout(done(false), timeout);
    video.addEventListener('seeked', seeked);
    video.currentTime = time;
  });
}
