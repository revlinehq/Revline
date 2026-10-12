import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { PlaybackTime } from './playback-time';

test('the visible counter uses minutes, seconds, and frames at the project frame rate', () => {
  const html = renderToStaticMarkup(<PlaybackTime time={2.5} duration={15} fps={30} playing={false} className="counter" />);
  expect(html).toContain('>00:02:15<span> / 00:15:00</span>');
  expect(html).toContain('minutes:seconds:frames');
  expect(html).toContain('30 fps');
});

test('the frame display keeps the last frame before a minute rollover', () => {
  const html = renderToStaticMarkup(<PlaybackTime time={59.9995} duration={61.5} fps={24} playing={false} className="counter" />);
  expect(html).toContain('>00:59:23<span> / 01:01:12</span>');
});

test('one frame increments the counter using the configured fps', () => {
  for (const fps of [24, 30, 60]) {
    const html = renderToStaticMarkup(<PlaybackTime time={1 / fps} duration={15} fps={fps} playing={false} className="counter" />);
    expect(html).toContain('>00:00:01<span> / 00:15:00</span>');
  }
});
