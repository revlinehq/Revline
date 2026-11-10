/** The local script reads metadata, opens a scoped multipart upload, and prints finishUpload arguments. */
export function localUploadScript(input: { filePath: string; endpoint: string; token: string; kind: 'video' | 'image' | 'audio' | 'model' }) {
  return `#!/bin/sh
set -e
node --input-type=module <<'REVLINE_UPLOAD'
import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const input = ${JSON.stringify(input)};
async function main() {
  const file = await open(input.filePath, 'r');
  try {
    const { size } = await file.stat();
    if (!Number.isSafeInteger(size) || size < 1) throw new Error('The file is empty or its size is unreadable.');
    if (input.kind === 'model') {
      if(size > 32 * 1024 * 1024) throw new Error('Use a self-contained GLB model under 32 MB.');
      const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + input.token };
      const prepared = await fetch(input.endpoint, { method: 'POST', headers, body: JSON.stringify({ size }) });
      const upload = await prepared.json();
      if (!prepared.ok) throw new Error(upload.error || 'Could not prepare model upload.');
      const stored = await fetch(upload.modelUploadUrl, { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: await file.readFile() });
      if (!stored.ok) throw new Error('Could not store model.');
      const { storageId } = await stored.json();
      const finished = await fetch(input.endpoint, { method: 'POST', headers, body: JSON.stringify({ storageId }) });
      const result = await finished.json();
      if (!finished.ok) throw new Error(result.error || 'Could not finish model upload.');
      console.log(JSON.stringify(result));
      return;
    }
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
    // Four parts travel at once, each streamed from disk, so memory stays flat for any file size.
    const parts = new Array(upload.urls.length);
    let next = 0, failure;
    const sendPart = async index => {
      const start = index * upload.partSize, length = Math.min(upload.partSize, size - start);
      for (let attempt = 0; ; attempt++) {
        const body = createReadStream(input.filePath, { start, end: start + length - 1 });
        try {
          const response = await fetch(upload.urls[index], { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(length) }, body, duplex: 'half' });
          if (!response.ok) throw new Error('Upload part ' + (index + 1) + ' failed (HTTP ' + response.status + ').');
          const part = await response.json();
          if (part.partNumber !== index + 1 || typeof part.etag !== 'string' || !part.etag) throw new Error('Storage returned an invalid upload part.');
          parts[index] = { partNumber: part.partNumber, etag: part.etag };
          return;
        } catch (error) {
          // One part failing for good stops the others: the upload cannot complete without it.
          if (failure) return;
          if (attempt >= 2) { failure = new Error(error.message + ' Request a new upload and retry.'); return; }
          await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
        } finally { body.destroy(); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, upload.urls.length) }, async () => { while (!failure && next < upload.urls.length) await sendPart(next++); }));
    if (failure) throw failure;
    if ((await file.stat()).size !== size) throw new Error('The local file size changed during upload. Request a new upload.');
    console.log(JSON.stringify({ uploadId: upload.uploadId, parts }));
  } finally { await file.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
REVLINE_UPLOAD`;
}
