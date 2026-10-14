import { expect, test } from 'vitest';
import { normalizeMediaFile } from './media-file';

test('normalizes OS drops with no MIME while preserving filename, bytes and modification time', async () => {
  for (const type of ['', 'application/octet-stream']) {
    const file = new File(['source bytes'], 'clip.MP4', { type, lastModified: 123 });
    const accepted = normalizeMediaFile(file)!;
    expect(accepted.type).toBe('video/mp4');
    expect(accepted.name).toBe(file.name);
    expect(accepted.lastModified).toBe(123);
    expect(await accepted.text()).toBe('source bytes');
  }
});

test('accepts explicit media types and rejects empty or explicitly non-media files', () => {
  const original = new File(['source'], 'clip.mp4', { type: 'video/mp4' });
  expect(normalizeMediaFile(original)).toBe(original);
  expect(normalizeMediaFile(new File([], 'clip.mp4'))).toBeNull();
  expect(normalizeMediaFile(new File(['text'], 'clip.mp4', { type: 'text/plain' }))).toBeNull();
  expect(normalizeMediaFile(new File(['unknown'], 'unknown.file'))).toBeNull();
});
