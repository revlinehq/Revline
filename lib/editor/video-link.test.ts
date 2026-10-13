import { expect, test } from 'vitest';
import { parseVideoLink } from './video-link';

test('canonicalizes only a single YouTube video, ignoring playlist arguments', () => {
  for (const url of ['https://youtu.be/BaW_jenozKc?t=1', 'https://www.youtube.com/watch?v=BaW_jenozKc&list=playlist', 'https://youtube.com/shorts/BaW_jenozKc', 'https://m.youtube.com/embed/BaW_jenozKc']) {
    expect(parseVideoLink(url)).toEqual({ kind: 'youtube', url: 'https://www.youtube.com/watch?v=BaW_jenozKc' });
  }
  expect(() => parseVideoLink('https://youtube.com/playlist?list=anything')).toThrow('one YouTube');
});
test('keeps signed MP4 query parameters but refuses local or credentialed links', () => {
  expect(parseVideoLink('https://cdn.example.com/video.mp4?signature=abc#t=1')).toEqual({ kind: 'file', url: 'https://cdn.example.com/video.mp4?signature=abc' });
  for (const url of ['http://example.com/video.mp4', 'https://user:password@example.com/video.mp4', 'https://localhost/video.mp4', 'https://127.0.0.1/video.mp4', 'https://2130706433/video.mp4', 'https://[::1]/video.mp4', 'https://host.internal/video.mp4', 'https://example.com:444/video.mp4', 'javascript:alert(1)']) expect(() => parseVideoLink(url)).toThrow();
});
