/** The local script reads metadata, opens a scoped multipart upload, and prints finishUpload arguments. */
export function localUploadScript(input: { filePath: string; endpoint: string; token: string; kind: 'video' | 'image' | 'audio' }) {
  return `#!/bin/sh
set -e
node --input-type=module <<'REVLINE_UPLOAD'
import { open } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const input = ${JSON.stringify(input)};
async function main() {
  const file = await open(input.filePath, 'r');
  try {
    const { size } = await file.stat();
    if (!Number.isSafeInteger(size) || size < 1) throw new Error('The file is empty or its size is unreadable.');
    const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=duration', '-of', 'json', '-i', input.filePath], { maxBuffer: 1024 * 1024 });
    const probe = JSON.parse(stdout), streams = probe.streams ?? [];
    const visual = streams.find(stream => stream.codec_type === 'video');
    const stream = streams.find(stream => stream.codec_type === input.kind) ?? visual;
    const metadata = { size };
    if (input.kind !== 'image') {
      const duration = Number(probe.format?.duration) || Number(stream?.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('The file has no readable duration.');
      metadata.duration = duration;
    }
    if (input.kind !== 'audio') {
      const rotation = Number(visual?.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? visual?.tags?.rotate ?? 0);
      const rotated = Math.abs(rotation % 180) === 90;
      metadata.width = rotated ? visual?.height : visual?.width;
      metadata.height = rotated ? visual?.width : visual?.height;
      if (![metadata.width, metadata.height].every(value => Number.isInteger(value) && value > 0)) throw new Error('The file has no readable dimensions.');
    }
    const prepared = await fetch(input.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + input.token }, body: JSON.stringify(metadata) });
    const upload = await prepared.json();
    if (!prepared.ok) throw new Error(upload.error ?? 'Could not prepare the upload.');
    const parts = [];
    for (let index = 0; index < upload.urls.length; index++) {
      const position = index * upload.partSize, length = Math.min(upload.partSize, size - position);
      const buffer = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await file.read(buffer, read, length - read, position + read);
        if (!bytesRead) throw new Error('The local file changed during upload. Request a new upload.');
        read += bytesRead;
      }
      const response = await fetch(upload.urls[index], { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: buffer });
      if (!response.ok) throw new Error('Upload part ' + (index + 1) + ' failed. Request a new upload and retry.');
      const part = await response.json();
      if (part.partNumber !== index + 1 || typeof part.etag !== 'string' || !part.etag) throw new Error('Storage returned an invalid upload part.');
      parts.push({ partNumber: part.partNumber, etag: part.etag });
    }
    if ((await file.stat()).size !== size) throw new Error('The local file size changed during upload. Request a new upload.');
    console.log(JSON.stringify({ uploadId: upload.uploadId, parts }));
  } finally { await file.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
REVLINE_UPLOAD`;
}
