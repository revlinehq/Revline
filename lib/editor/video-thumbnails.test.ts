import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

function decoderFixture() {
  const videos: Video[] = [];
  let live = 0, maximumLive = 0, draws = 0;
  class Video extends EventTarget {
    muted = false; playsInline = false; preload = ''; crossOrigin = '';
    videoWidth = 320; videoHeight = 180; duration = 10; error = null;
    src = ''; position = 0;
    get currentTime() { return this.position; }
    set currentTime(time: number) { this.position = time; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
    load() { if (this.src) { live++; maximumLive = Math.max(maximumLive, live); queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))); } }
    removeAttribute() { this.src = ''; live--; }
  }
  vi.stubGlobal('document', { createElement: (kind: string) => {
    if (kind === 'video') { const video = new Video(); videos.push(video); return video; }
    let lastTime = 0;
    return { width: 0, height: 0, getContext: () => ({ drawImage: (video: Video) => { draws++; lastTime = video.currentTime; } }), toDataURL: () => `data:image/jpeg;base64,frame-${lastTime}` };
  } });
  return { videos, draws: () => draws, maximumLive: () => maximumLive };
}

test('deduplicates shared clip requests for the same source frames', async () => {
  const fixture = decoderFixture();
  const { videoThumbnails } = await import('./video-thumbnails');
  const [first, second] = await Promise.all([videoThumbnails('fixture.mp4', [0, 2], 'source'), videoThumbnails('fixture.mp4', [0, 2], 'source')]);
  expect(first).toEqual(second);
  expect(new Set(first).size).toBe(2);
  expect(fixture.videos).toHaveLength(1);
  expect(fixture.draws()).toBe(2);
});
test('keeps decoded stills when a signed source URL is refreshed', async () => {
  const fixture = decoderFixture();
  const { videoThumbnails } = await import('./video-thumbnails');
  const original = await videoThumbnails('fixture.mp4?lease=old', [0, 3], 'stable-asset-id');
  expect(await videoThumbnails('fixture.mp4?lease=new', [0, 3], 'stable-asset-id')).toEqual(original);
  expect(fixture.videos).toHaveLength(1);
});
test('limits concurrent video decoders while processing multiple assets', async () => {
  const fixture = decoderFixture();
  const { videoThumbnails } = await import('./video-thumbnails');
  await Promise.all(Array.from({ length: 8 }, (_, index) => videoThumbnails(`source-${index}.mp4`, [0, 2, 4])));
  expect(fixture.maximumLive()).toBe(2);
  expect(fixture.draws()).toBe(24);
});
test('publishes the first frame before waiting for every sample', async () => {
  decoderFixture();
  const { videoThumbnails } = await import('./video-thumbnails');
  const updates: number[] = [];
  await videoThumbnails('fixture.mp4', [0, 2, 4], 'source', time => updates.push(time));
  expect(updates).toEqual([0, 2, 4]);
});
