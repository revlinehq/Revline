import { beforeEach, expect, test, vi } from 'vitest';
import type { Id } from '@/convex/_generated/dataModel';
import { inspectMedia, uploadMultipart } from './media';
import { uploadSourceFile, type SourceUploadTransport } from './upload-source';

vi.mock('./media', () => ({ inspectMedia: vi.fn(), uploadMultipart: vi.fn() }));

const uploadId = 'upload-lease' as Id<'r2Uploads'>;
const assetId = 'uploaded-source' as Id<'assets'>;
const file = { name: 'footage.mp4', type: 'video/mp4', size: 100 } as File;
const metadata = { kind: 'video' as const, duration: 6, width: 1920, height: 1080 };
const parts = [{ partNumber: 1, etag: 'completed-part' }];

function transport(): SourceUploadTransport {
  return {
    start: vi.fn().mockResolvedValue({ uploadId, partSize: 100 }),
    partUrl: vi.fn().mockResolvedValue('https://upload.example/part'),
    complete: vi.fn().mockResolvedValue(assetId),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(inspectMedia).mockResolvedValue(metadata);
  vi.mocked(uploadMultipart).mockResolvedValue(parts);
});

test('returns the stored source without aborting its completed upload', async () => {
  const cloud = transport();
  expect(await uploadSourceFile(file, cloud, vi.fn())).toBe(assetId);
  expect(cloud.start).toHaveBeenCalledWith(metadata);
  expect(cloud.complete).toHaveBeenCalledWith(uploadId, parts);
  expect(cloud.abort).not.toHaveBeenCalled();
});

test('does not create a cloud upload for unreadable media', async () => {
  const cloud = transport();
  vi.mocked(inspectMedia).mockRejectedValue(new Error('Unreadable media.'));
  await expect(uploadSourceFile(file, cloud, vi.fn())).rejects.toThrow('Unreadable media.');
  expect(cloud.start).not.toHaveBeenCalled();
  expect(cloud.abort).not.toHaveBeenCalled();
});

test('releases an incomplete multipart upload and preserves its original error if cleanup fails', async () => {
  const cloud = transport();
  vi.mocked(uploadMultipart).mockRejectedValue(new Error('Connection interrupted.'));
  vi.mocked(cloud.abort).mockRejectedValue(new Error('Cleanup unavailable.'));
  await expect(uploadSourceFile(file, cloud, vi.fn())).rejects.toThrow('Connection interrupted.');
  expect(cloud.abort).toHaveBeenCalledExactlyOnceWith(uploadId);
  expect(cloud.complete).not.toHaveBeenCalled();
});

test('releases the lease when cloud completion fails', async () => {
  const cloud = transport();
  vi.mocked(cloud.complete).mockRejectedValue(new Error('Could not complete upload.'));
  await expect(uploadSourceFile(file, cloud, vi.fn())).rejects.toThrow('Could not complete upload.');
  expect(cloud.abort).toHaveBeenCalledExactlyOnceWith(uploadId);
});

test('rejects a missing source without aborting an already completed upload', async () => {
  const cloud = transport();
  vi.mocked(cloud.complete).mockResolvedValue(null);
  await expect(uploadSourceFile(file, cloud, vi.fn())).rejects.toThrow('The upload did not return media.');
  expect(cloud.abort).not.toHaveBeenCalled();
});
