import { AwsClient } from 'aws4fetch';
import { ConvexError } from 'convex/values';
import { uploadPartBytes, uploadPartCount } from '../../lib/storage/upload-parts';

// Direct-to-storage uploads: browsers PUT part bytes straight to R2's S3 endpoint with
// presigned URLs instead of through the media Worker. Off unless all four settings exist
// (see docs/uploads.md), so the Worker path remains the default and the fallback.
// A direct upload lives entirely on the S3 API (create, parts, list, complete, abort):
// nothing here assumes an upload created through the Worker's bucket binding can be
// continued over S3, or the reverse.

const PART_LINK_SECONDS = 3600;
type DirectUpload = { key: string; uploadId: string };
export type DirectPart = { partNumber: number; etag: string; size: number };

let cached: { id: string; client: AwsClient; base: string } | null = null;
function config() {
  const { R2_UPLOAD_ACCESS_KEY_ID: accessKeyId, R2_UPLOAD_SECRET_ACCESS_KEY: secretAccessKey, R2_UPLOAD_ENDPOINT: endpoint, R2_UPLOAD_BUCKET: bucket } = process.env;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) return null;
  // One client per settings, so its derived signing key is reused across a batch of links.
  const id = [accessKeyId, secretAccessKey, endpoint, bucket].join('\n');
  if (cached?.id !== id) cached = { id, client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }), base: `${endpoint.replace(/\/$/, '')}/${bucket}` };
  return cached;
}
/** True when this deployment hands out presigned storage links. */
export const directUploadsEnabled = () => config() !== null;
function storage() {
  const settings = config();
  // Switched off while this upload was open: the browser starts it again through the Worker.
  if (!settings) throw new ConvexError('This upload can no longer continue. Add the file again.');
  return settings;
}
const objectUrl = (base: string, { key }: { key: string }, query = '') => `${base}/${key.split('/').map(encodeURIComponent).join('/')}${query}`;
const uploadQuery = (uploadId: string) => `uploadId=${encodeURIComponent(uploadId)}`;
const unquote = (etag: string) => etag.replace(/&quot;|&#34;|"/g, '');
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
async function failed(action: string, response: Response): Promise<never> {
  // Storage error bodies name the bucket and key; keep only the code.
  const code = tag(await response.text().catch(() => ''), 'Code');
  throw new Error(`Cloud storage could not ${action} (${response.status}${code ? ` ${code}` : ''}). Please retry.`);
}

/** Opens a multipart upload on the S3 API and returns its upload id. */
export async function createDirectUpload(key: string, contentType: string) {
  const { client, base } = storage();
  const response = await client.fetch(objectUrl(base, { key }, '?uploads'), { method: 'POST', headers: { 'Content-Type': contentType } });
  if (!response.ok) return failed('open the upload', response);
  const uploadId = tag(await response.text(), 'UploadId');
  if (!uploadId) throw new Error('Cloud storage did not open the upload');
  return uploadId;
}

/** A one-hour URL the browser PUTs one part to; storage answers with the part's ETag header.
 * The part's exact byte length is part of the signature, so the link accepts nothing else. */
export async function directPartUrl(upload: DirectUpload, partNumber: number, size: number) {
  const { client, base } = storage();
  const signed = await client.sign(objectUrl(base, upload, `?partNumber=${partNumber}&${uploadQuery(upload.uploadId)}&X-Amz-Expires=${PART_LINK_SECONDS}`), { method: 'PUT', headers: { 'Content-Length': String(size) }, aws: { signQuery: true, allHeaders: true } });
  return signed.url;
}
export const DIRECT_PART_LINK_MS = PART_LINK_SECONDS * 1000;

/** Every part storage holds for an upload, in part order. This is what resume and completion trust. */
export async function listDirectParts(upload: DirectUpload): Promise<DirectPart[]> {
  const { client, base } = storage(), parts: DirectPart[] = [];
  for (let marker = '0'; ; ) {
    const response = await client.fetch(objectUrl(base, upload, `?${uploadQuery(upload.uploadId)}&max-parts=1000&part-number-marker=${marker}`));
    // An upload that was aborted or never existed holds nothing.
    if (response.status === 404) return [];
    if (!response.ok) return failed('list the upload', response);
    const xml = await response.text();
    for (const [, part] of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
      const partNumber = Number(tag(part, 'PartNumber')), size = Number(tag(part, 'Size')), etag = unquote(tag(part, 'ETag') ?? '');
      if (Number.isInteger(partNumber) && Number.isSafeInteger(size) && etag) parts.push({ partNumber, etag, size });
    }
    const next = tag(xml, 'NextPartNumberMarker');
    if (tag(xml, 'IsTruncated') !== 'true' || !next || next === marker) return parts.sort((a, b) => a.partNumber - b.partNumber);
    marker = next;
  }
}

async function head(key: string) {
  const { client, base } = storage();
  const response = await client.fetch(objectUrl(base, { key }), { method: 'HEAD' });
  if (response.status === 404) return null;
  if (!response.ok) return failed('read the file', response);
  return true;
}

/** True when the object already exists, as after a completion whose response was lost. */
export const directObjectExists = async (key: string) => await head(key) !== null;

/** Assembles the listed parts into the object. */
export async function completeDirectUpload(upload: DirectUpload, parts: { partNumber: number; etag: string }[]) {
  const { client, base } = storage();
  const body = `<CompleteMultipartUpload>${parts.map(part => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>&quot;${unquote(part.etag)}&quot;</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
  const response = await client.fetch(objectUrl(base, upload, `?${uploadQuery(upload.uploadId)}`), { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body });
  if (!response.ok) return failed('finish the upload', response);
  // S3 can report a failed completion inside a 200 response.
  const xml = await response.text();
  if (/<Error>/.test(xml)) throw new Error(`Cloud storage could not finish the upload (${tag(xml, 'Code') ?? 'error'}). Please retry.`);
}

/** Releases an unfinished upload's parts. An upload that is already gone counts as released. */
export async function abortDirectUpload(upload: DirectUpload) {
  const { client, base } = storage();
  const response = await client.fetch(objectUrl(base, upload, `?${uploadQuery(upload.uploadId)}`), { method: 'DELETE' });
  if (!response.ok && response.status !== 404) return failed('release the upload', response);
}

type SizedUpload = DirectUpload & { size: number; partSize: number };
const rightSize = (upload: SizedUpload, part: DirectPart) => part.partNumber >= 1 && part.partNumber <= uploadPartCount(upload.size, upload.partSize) && part.size === uploadPartBytes(upload.size, upload.partSize, part.partNumber);
/** The stored parts a resumed upload may skip: right part number, exact size. */
export async function resumableDirectParts(upload: SizedUpload) {
  return (await listDirectParts(upload)).filter(part => rightSize(upload, part)).map(({ partNumber, etag }) => ({ partNumber, etag }));
}
/** The media Worker no longer sees these bytes, so before completion storage itself must show
 * every part with its exact size and the etag the browser reported. Null when it does not. */
export async function verifiedDirectParts(upload: SizedUpload, claimed: { partNumber: number; etag: string }[]) {
  const stored = await listDirectParts(upload), count = uploadPartCount(upload.size, upload.partSize);
  if (stored.length !== count || claimed.length !== count) return null;
  const valid = stored.every((part, index) => part.partNumber === index + 1 && rightSize(upload, part) && claimed[index].partNumber === part.partNumber && unquote(claimed[index].etag) === part.etag);
  return valid ? stored.map(({ partNumber, etag }) => ({ partNumber, etag })) : null;
}
