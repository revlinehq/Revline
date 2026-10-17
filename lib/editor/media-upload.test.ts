import { afterEach, expect, test, vi } from 'vitest';
import { uploadMultipart } from './media';

function uploadFixture() {
  const requests: Request[] = [];
  class Request {
    upload = { onprogress: undefined as undefined | ((event: { loaded: number }) => void) };
    onload?: () => void;
    onerror?: () => void;
    ontimeout?: () => void;
    onabort?: () => void;
    status = 0;
    responseText = '';
    timeout = 0;
    partNumber = 0;
    aborted = false;
    open(_method: string, url: string) { this.partNumber = Number(url.split('/').at(-1)); }
    setRequestHeader() {}
    send(_blob: Blob) { requests.push(this); }
    abort() { this.aborted = true; this.onabort?.(); }
    progress(loaded: number) { this.upload.onprogress?.({ loaded }); }
    finish(status = 200) {
      this.status = status;
      this.responseText = JSON.stringify({ partNumber: this.partNumber, etag: `etag-${this.partNumber}` });
      this.onload?.();
    }
  }
  vi.stubGlobal('XMLHttpRequest', Request);
  return requests;
}

async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function footage(parts: number) { return new File([new Uint8Array(parts * 10)], 'footage.mp4'); }
const partUrl = async (part: number) => `https://upload.example/${part}`;

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('uploads three parts concurrently, aggregates progress and returns out-of-order completions in part order', async () => {
  const requests = uploadFixture(), progress: number[] = [];
  const uploading = uploadMultipart(footage(5), 10, partUrl, percent => progress.push(percent));
  await flush();
  expect(requests.map(request => request.partNumber)).toEqual([1, 2, 3]);
  requests[0].progress(5); requests[1].progress(10); requests[2].progress(10);
  expect(progress.at(-1)).toBe(50);
  requests[2].finish(); await flush();
  expect(requests.map(request => request.partNumber)).toEqual([1, 2, 3, 4]);
  requests[1].finish(); await flush();
  expect(requests.map(request => request.partNumber)).toEqual([1, 2, 3, 4, 5]);
  requests[0].finish(); requests[4].finish(); requests[3].finish();
  expect(await uploading).toEqual([1, 2, 3, 4, 5].map(partNumber => ({ partNumber, etag: `etag-${partNumber}` })));
  expect(progress.at(-1)).toBe(100);
  expect(progress.slice(0, -1).every(percent => percent < 100)).toBe(true);
  expect(progress.every((percent, index) => index === 0 || percent >= progress[index - 1])).toBe(true);
});

test('retries only the failed part without double-counting bytes or lowering progress', async () => {
  vi.useFakeTimers();
  const requests = uploadFixture(), progress: number[] = [];
  const uploading = uploadMultipart(footage(3), 10, partUrl, percent => progress.push(percent));
  await flush();
  requests[1].progress(8); requests[1].finish(503);
  requests[0].finish(); requests[2].finish(); await flush();
  expect(requests).toHaveLength(3);
  const beforeRetry = progress.at(-1);
  await vi.advanceTimersByTimeAsync(500);
  expect(requests.map(request => request.partNumber)).toEqual([1, 2, 3, 2]);
  requests[3].progress(2);
  expect(progress.at(-1)).toBe(beforeRetry);
  requests[3].finish();
  await expect(uploading).resolves.toEqual([1, 2, 3].map(partNumber => ({ partNumber, etag: `etag-${partNumber}` })));
  expect(progress.every((percent, index) => index === 0 || percent >= progress[index - 1])).toBe(true);
});

test('aborts in-flight sibling parts after the retry limit and stops scheduling parts before lease cleanup', async () => {
  vi.useFakeTimers();
  const requests = uploadFixture(), progress = vi.fn();
  const result = uploadMultipart(footage(5), 10, partUrl, progress).catch(error => error);
  await flush();
  requests[0].finish(503); await flush();
  await vi.advanceTimersByTimeAsync(500);
  requests[3].finish(503); await flush();
  await vi.advanceTimersByTimeAsync(1000);
  requests[4].finish(503);
  expect(await result).toEqual(new Error('Upload failed. Please try again.'));
  expect(requests.map(request => request.partNumber)).toEqual([1, 2, 3, 1, 1]);
  expect(requests[1].aborted).toBe(true);
  expect(requests[2].aborted).toBe(true);
  expect(progress).not.toHaveBeenCalledWith(100);
});
