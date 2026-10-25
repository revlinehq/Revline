// Export render artifacts (plans and chunks) in the Fly app's Tigris bucket. Credentials
// are the app secrets `fly storage create` sets: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
// AWS_ENDPOINT_URL_S3 and BUCKET_NAME. Bodies stream with an unsigned payload hash.
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AwsClient } from 'aws4fetch';

function storage() {
  const { AWS_ACCESS_KEY_ID: accessKeyId, AWS_SECRET_ACCESS_KEY: secretAccessKey, AWS_ENDPOINT_URL_S3: endpoint, BUCKET_NAME: bucket } = process.env;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) throw new Error('Render artifact storage is not configured.');
  return { client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: process.env.AWS_REGION || 'auto' }), base: `${endpoint.replace(/\/$/, '')}/${bucket}` };
}
const url = (base, key) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function request(method, key, init = {}) {
  const { client, base } = storage();
  const response = await client.fetch(url(base, key), { method, ...init, headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', ...init.headers } });
  return response;
}

export async function putFile(key, path, signal) {
  const { size } = await stat(path);
  const response = await request('PUT', key, { body: Readable.toWeb(createReadStream(path)), duplex: 'half', headers: { 'content-length': String(size) }, signal });
  if (!response.ok) throw new Error(`Uploading ${key} failed (${response.status}).`);
}

export async function getFile(key, path, signal) {
  const response = await request('GET', key, { signal });
  if (!response.ok || !response.body) throw new Error(`Downloading ${key} failed (${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path), { signal });
}

/** Stream a tar object straight into `tar -x` so the archive never lands on disk. */
export async function getTar(key, directory, signal) {
  const response = await request('GET', key, { signal });
  if (!response.ok || !response.body) throw new Error(`Downloading ${key} failed (${response.status}).`);
  const tar = spawn('tar', ['-xf', '-', '-C', directory], { stdio: ['pipe', 'ignore', 'pipe'], signal });
  let stderr = ''; tar.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-500); });
  const exited = new Promise((accept, reject) => tar.on('close', code => code === 0 ? accept() : reject(new Error(`Extracting ${key} failed: ${stderr}`))));
  await pipeline(Readable.fromWeb(response.body), tar.stdin, { signal });
  await exited;
}

export async function exists(key, signal) {
  const response = await request('HEAD', key, { signal });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Checking ${key} failed (${response.status}).`);
  return true;
}

export async function remove(key) {
  const response = await request('DELETE', key).catch(() => null);
  return !!response?.ok;
}
