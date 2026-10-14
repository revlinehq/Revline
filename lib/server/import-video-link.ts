import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { stat, statfs } from 'node:fs/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { parseVideoLink } from '../editor/video-link';
import { AnalysisError } from '../media-analysis/errors';

const run = promisify(execFile);
export const MAX_IMPORT_BYTES = 500 * 1024 * 1024;
const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(ip, prefix, 'ipv4');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2001::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');

export function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

/** Resolve once and pin the HTTPS socket to the checked address, preventing DNS rebinding. */
export async function videoResponse(value: string, signal: AbortSignal, redirects = 0): Promise<import('node:http').IncomingMessage> {
  const link = parseVideoLink(value);
  if (link.kind !== 'file') throw new AnalysisError('Use a direct MP4 link for this download.', 400);
  const url = new URL(link.url);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new AnalysisError('This link does not point to a public video server.', 400);
  const selected = addresses.find(item => item.family === 4) ?? addresses[0];
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request(url, { signal, lookup: (_hostname, options, callback) => {
      if (options.all) callback(null, [selected]); else callback(null, selected.address, selected.family);
    }, headers: { 'User-Agent': 'Revline/1.0', Accept: 'video/mp4,application/octet-stream' } }, resolve);
    req.setTimeout(30_000, () => req.destroy(new Error('The video server stopped responding.')));
    req.on('error', reject); req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    response.destroy();
    if (!response.headers.location || redirects >= 5) throw new AnalysisError('The video link redirects too many times.', 400);
    return videoResponse(new URL(response.headers.location, url).toString(), signal, redirects + 1);
  }
  if (response.statusCode !== 200) {
    response.destroy();
    throw new AnalysisError(`The video server returned HTTP ${response.statusCode}. Use a public download link.`, response.statusCode! >= 500 ? 502 : 400);
  }
  const type = response.headers['content-type']?.split(';')[0].trim();
  if (type && !['video/mp4', 'application/octet-stream', 'binary/octet-stream'].includes(type)) {
    response.destroy(); throw new AnalysisError('That link opens a webpage instead of an MP4. Use the direct video link.', 400);
  }
  const size = Number(response.headers['content-length']);
  if (size > MAX_IMPORT_BYTES) { response.destroy(); throw new AnalysisError('Video-link imports support files up to 500 MB.', 400); }
  return response;
}

async function downloadMp4(url: string, path: string, signal: AbortSignal, onProgress: (percent: number) => void) {
  const response = await videoResponse(url, signal);
  const expected = Number(response.headers['content-length']);
  let received = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    received += chunk.length;
    if (expected > 0) onProgress(Math.min(60, Math.floor(received / expected * 60)));
    callback(received > MAX_IMPORT_BYTES ? new AnalysisError('Video-link imports support files up to 500 MB.', 400) : null, chunk);
  } });
  await pipeline(response, limit, createWriteStream(path), { signal });
  if (!received || (expected > 0 && expected !== received)) throw new Error('The video download was incomplete.');
}

export function youtubeArguments(url: string, path: string) {
  return ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-warnings', '--socket-timeout', '30', '--retries', '2', '--max-filesize', String(MAX_IMPORT_BYTES), '--match-filters', 'duration <= 300 & !is_live', '--js-runtimes', 'node', '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]', '--merge-output-format', 'mp4', '--remux-video', 'mp4', '--print', 'after_move:%(title)s', '-o', path, '--', url];
}

export async function importVideoLink(value: string, directory: string, signal: AbortSignal, onProgress: (percent: number) => void) {
  const link = parseVideoLink(value);
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < MAX_IMPORT_BYTES * 4) throw new AnalysisError('The media worker needs more free disk space before importing a video.', 503);
  const source = join(directory, 'download.mp4');
  let title = 'Imported video';
  if (link.kind === 'youtube') {
    const bundled = join(process.cwd(), '.data/video-import/bin/yt-dlp');
    const executable = process.env.YT_DLP_PATH || (existsSync(bundled) ? bundled : 'yt-dlp');
    try {
      const { stdout } = await run(executable, youtubeArguments(link.url, source), { signal, timeout: 600_000, maxBuffer: 2 * 1024 * 1024 });
      title = stdout.trim().split('\n').at(-1) || title;
    } catch (error) {
      if (signal.aborted) throw error;
      const stderr = String((error as { stderr?: string }).stderr ?? '');
      if (/sign in|confirm.*bot|private video|not available|unavailable|copyright|age.restricted/i.test(stderr)) throw new AnalysisError('YouTube blocked this download. Use a public MP4 link or upload the video file instead.', 400);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AnalysisError('YouTube import is unavailable on this media worker. Install yt-dlp first.', 503);
      throw new AnalysisError('Could not download this YouTube video. Try another public video or an MP4 link.', 400);
    }
  } else {
    await downloadMp4(link.url, source, signal, onProgress);
    try { title = decodeURIComponent(new URL(link.url).pathname.split('/').at(-1) || title).replace(/\.mp4$/i, ''); } catch { /* A safe default name works too. */ }
  }
  if (!existsSync(source)) throw new AnalysisError('This video-link import did not produce a file. Links must be public, up to 5 minutes and 500 MB, and not livestreams. Upload longer footage directly as a file.', 400);
  if ((await stat(source)).size > MAX_IMPORT_BYTES) throw new AnalysisError('Video-link imports support files up to 500 MB.', 400);
  onProgress(65);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,pix_fmt', '-of', 'json', source], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 }).catch(() => { throw new AnalysisError('The link did not contain a readable MP4 video.', 400); });
  const metadata = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; codec_name: string; width?: number; height?: number; pix_fmt?: string }[] };
  const video = metadata.streams?.find(stream => stream.codec_type === 'video');
  const audio = metadata.streams?.find(stream => stream.codec_type === 'audio');
  const duration = Number(metadata.format?.duration);
  if (!video?.width || !video.height || video.width > 16384 || video.height > 16384 || !Number.isFinite(duration) || duration <= 0 || duration > 300) throw new AnalysisError('Video links must contain a readable video up to 5 minutes long. Upload longer footage directly as a file.', 400);
  const path = join(directory, 'video.mp4');
  const copyVideo = video.codec_name === 'h264' && video.pix_fmt === 'yuv420p';
  // Keep supported streams intact; convert other codecs for browser preview and export.
  await run('ffmpeg', ['-v', 'error', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', ...(copyVideo ? ['-c:v', 'copy'] : ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']), '-c:a', audio?.codec_name === 'aac' ? 'copy' : 'aac', '-movflags', '+faststart', '-y', path], { signal, timeout: 600_000, maxBuffer: 1024 * 1024 });
  if ((await stat(path)).size > MAX_IMPORT_BYTES) throw new AnalysisError('The prepared video exceeds the 500 MB import limit.', 400);
  onProgress(80);
  const fileName = `${title.replace(/[\x00-\x1f/\\]/g, '').trim().slice(0, 180) || 'Imported video'}.mp4`;
  return { path, fileName, duration, width: copyVideo ? video.width : Math.floor(video.width / 2) * 2, height: copyVideo ? video.height : Math.floor(video.height / 2) * 2 };
}
