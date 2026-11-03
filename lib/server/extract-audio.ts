import { runMediaCommand as run } from './media-command';

/** Copy AAC without quality loss; convert other codecs to browser-playable AAC. */
export async function extractSourceAudio(input: string, output: string, signal: AbortSignal) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'json', input], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const { streams } = JSON.parse(stdout) as { streams: { codec_name: string }[] };
  if (!streams.length) return false;
  await run('ffmpeg', ['-v', 'error', '-i', input, '-map', '0:a:0', '-vn', ...(streams[0].codec_name === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']), '-movflags', '+faststart', '-y', output], { signal, timeout: 180_000, maxBuffer: 1024 * 1024 });
  return true;
}
