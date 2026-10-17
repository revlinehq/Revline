import { afterEach, expect, test, vi } from 'vitest';
import { inspectMedia } from './media';
afterEach(() => vi.unstubAllGlobals());
function fixture(width: number, height: number) {
  const media = { duration: 6, videoWidth: width, videoHeight: height, preload: '', onloadedmetadata: undefined as undefined | (() => void), onerror: undefined, removeAttribute: vi.fn(), load: vi.fn(), set src(_value: string) { queueMicrotask(() => this.onloadedmetadata?.()); } };
  vi.stubGlobal('document', { createElement: () => media });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:fixture', revokeObjectURL: vi.fn() });
  return { name: 'voice.mp4', type: 'video/mp4', size: 512 * 1024 * 1024 } as File;
}
test('classifies an audio-only MP4 without passing zero dimensions to Convex', async () => {
  expect(await inspectMedia(fixture(0, 0))).toEqual({ kind: 'audio', duration: 6 });
});
test('rejects incomplete video dimensions before uploading', async () => {
  await expect(inspectMedia(fixture(1920, 0))).rejects.toThrow('incomplete dimensions');
});
test('accepts readable video larger than the old 100 MB limit', async () => {
  expect(await inspectMedia(fixture(1920, 1080))).toEqual({ kind: 'video', duration: 6, width: 1920, height: 1080 });
});

test('starts upload inspection at metadata without waiting for the thumbnail frame', async () => {
  const poster = new Blob(['jpeg'], { type: 'image/jpeg' }), capture = vi.fn(), revoke = vi.fn();
  const media = {
    duration: 6, videoWidth: 1920, videoHeight: 1080, readyState: 1, preload: '',
    onloadedmetadata: null as null | (() => void), onloadeddata: null as null | (() => void), onerror: null,
    removeAttribute: vi.fn(), load: vi.fn(),
    set src(_value: string) { queueMicrotask(() => this.onloadedmetadata?.()); },
  };
  vi.stubGlobal('document', { createElement: (tag: string) => tag === 'canvas'
    ? { getContext: () => ({ drawImage: vi.fn() }), toBlob: (done: (blob: Blob) => void) => done(poster) }
    : media });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:fixture', revokeObjectURL: revoke });
  const file = { name: 'video.mp4', type: 'video/mp4', size: 300_000_000 } as File;

  expect(await inspectMedia(file, capture, false)).toEqual({ kind: 'video', duration: 6, width: 1920, height: 1080 });
  expect(capture).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
  media.onloadeddata?.();
  expect(capture).toHaveBeenCalledExactlyOnceWith(poster);
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:fixture');
});
