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

test('new split and trim requests can retain same-source stills without decoding or relabeling their sample time', async () => {
  const fixture = decoderFixture();
  const { videoThumbnails, cachedNearestVideoThumbnail, cachedVideoThumbnail } = await import('./video-thumbnails');
  await videoThumbnails('same.mp4', [0, 3, 6], 'asset');
  expect(cachedVideoThumbnail('asset', 3.1)).toBeUndefined();
  expect(cachedNearestVideoThumbnail('asset', 3.1)).toEqual({ time: 3, image: 'data:image/jpeg;base64,frame-3' });
  expect(cachedNearestVideoThumbnail('asset', 3.1, [4, 8])).toEqual({ time: 6, image: 'data:image/jpeg;base64,frame-6' });
  expect(cachedNearestVideoThumbnail('asset', 3.1, [7, 10])).toBeUndefined();
  expect(cachedNearestVideoThumbnail('other-asset', 3.1)).toBeUndefined();
  expect(cachedNearestVideoThumbnail('asset', NaN)).toBeUndefined();
  expect(fixture.videos).toHaveLength(1); expect(fixture.draws()).toBe(3);
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

test('split ranges share one source decoder and each range receives its first frame first',async()=>{
 const fixture=decoderFixture();
 const{videoThumbnails}=await import('./video-thumbnails');
 const updates:number[]=[];
 await Promise.all([videoThumbnails('same.mp4',[0,1,2],'asset',time=>updates.push(time)),videoThumbnails('same.mp4',[3,4,5],'asset',time=>updates.push(time)),videoThumbnails('same.mp4',[6,7,8],'asset',time=>updates.push(time))]);
 expect(fixture.videos).toHaveLength(1);
 expect(updates.slice(0,3)).toEqual([0,3,6]);
 expect(new Set(updates).size).toBe(9);expect(fixture.draws()).toBe(9);
});

test('discards stale queued frames without canceling another clip sharing its first frame',async()=>{
 const fixture=decoderFixture();
 const{videoThumbnails}=await import('./video-thumbnails');
 const obsolete=new AbortController(),stale:number[]=[],shared:number[]=[];
 const first=videoThumbnails('same.mp4',[0,1,2],'asset',time=>stale.push(time),obsolete.signal);
 const second=videoThumbnails('same.mp4',[0,3],'asset',time=>shared.push(time));
 obsolete.abort();
 expect(await first).toEqual([null,null,null]);expect((await second).every(Boolean)).toBe(true);
 expect(stale).toEqual([]);expect(shared).toEqual([0,3]);expect(fixture.draws()).toBe(2);expect(fixture.videos).toHaveLength(1);
});
