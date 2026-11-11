# Uploads

How source footage and Library files reach R2. Code: `lib/editor/multipart-upload.ts` (browser engine), `lib/editor/upload-resume.ts` (resume), `lib/storage/part-links.ts` (link cache), `convex/r2.ts` and `convex/cloudMedia.ts` (leases, links, completion), `cf-workers/media/worker.ts` (`/part`).

## Transfer

A file is sent as an R2 multipart upload in 32 MiB parts (larger only when a file would need more than 10,000). The browser starts with 4 parts in flight and measures total throughput every 2.5 s: a step up is kept when it adds 8%, a step that adds 25% is followed by a doubling, a step that adds nothing is undone and tried again 45 s later, and a failed part halves the count for 30 s. The ceiling is 12 on HTTP/2 or HTTP/3 (the media Worker) and 6 when the protocol is HTTP/1.1 or unknown. Save-Data or a slow `effectiveType` starts at 2 with a ceiling of 4.

Part links come from `partUrls` in batches of up to 64 (the server allows 100) with a look-ahead refill; `partUrl` remains for older clients and the iOS app. Node uploads (`lib/server/upload-media-file.ts`) send 6 parts at once; the MCP local upload script sends 4, streamed from disk.

Measured on a ~500 Mbps+ uplink in headless Chrome (November 9, 2026): 32 MiB parts gave 62 s for 5 GB, 16 MiB the same, 64 MiB about 100 s.

## Interruptions

- Offline or failing requests: each part waits for `online` and retries with backoff (1 s to 30 s). The upload stops only after a part has failed for 15 minutes, with a message that says to add the file again.
- Closed tab, reload, crash, or that 15-minute stop: the browser keeps a note per file in IndexedDB (`revline-uploads`): upload id, part size, and each stored part's etag with the Worker's receipt. Adding the same file again (same name, size, modified time, and a SHA-256 of its first and last 2 MiB) calls `resume`, which checks the lease (same owner, same project, not finished, not expired) and each receipt's HMAC, and returns the parts that count. Only the rest are sent.
- The receipt is an HMAC by the media Worker over key, upload id, part number, size and etag, returned in the `X-Part-Receipt` header. R2's Worker binding cannot list the parts of a multipart upload, so this is how the server knows a part exists without trusting the browser.
- Limits: a project upload lease lasts 24 hours from its start; a Library upload is cleared after 2 idle hours. After that the file starts over. Resume is per browser profile. Cancelling releases the upload at once.

## Direct-to-storage parts (off until configured)

With four Convex environment variables set, browser uploads PUT their parts straight to R2's S3 endpoint with presigned links instead of through the media Worker. Without them nothing changes: every upload uses the Worker as above. Uploads from the media worker process, the MCP scripts and the iOS app always use the Worker.

A direct upload lives entirely on the S3 API (`convex/lib/direct_upload.ts`): it is created, listed, completed and aborted there, and its lease carries `direct: true`. The Worker never sees the bytes, so each link is signed for its part's exact byte length, and before completing, Convex lists the parts in storage and requires every part to be present with its exact size and the etag the browser reported; resume uses the same list in place of Worker receipts. The finished object is then read back through the Worker, which fails if the S3 settings point at a different bucket. R2's S3 endpoint speaks HTTP/1.1, so a browser sends at most 6 parts at once there (12 through the Worker).

### What to set

1. In the Cloudflare dashboard, R2, create an **Account API token** (S3 credentials) with **Object Read & Write** limited to the media bucket. Note the access key id, the secret and the account id.
2. Add this CORS policy to the bucket (R2, bucket, Settings, CORS policy). List exactly the app origins of that environment:

```json
[
  {
    "AllowedOrigins": ["https://tryrevline.com", "https://www.tryrevline.com", "https://editor.tryrevline.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

For development add the local origins used there (`http://localhost:3001` and the ports in `cf-workers/media/wrangler.jsonc`). Development and production currently bind the same bucket, `revline-editor-media`, so one policy has to list both sets of origins and a change to it affects production.

3. Set the variables on the Convex deployment (development: `majestic-alpaca-541`; production: its own deployment, with its own token):

```sh
npx convex env set R2_UPLOAD_ACCESS_KEY_ID <access key id>
npx convex env set R2_UPLOAD_SECRET_ACCESS_KEY <secret access key>
npx convex env set R2_UPLOAD_ENDPOINT https://<account id>.r2.cloudflarestorage.com
npx convex env set R2_UPLOAD_BUCKET revline-editor-media
```

Removing any one of them switches new uploads back to the Worker. A direct upload that was open at that moment cannot continue: the browser starts that file again through the Worker, and R2 drops the unfinished parts after 7 days. If the token is wrong or revoked while the variables stay set, new uploads fall back to the Worker by themselves.

### Not yet verified

No R2 S3 credentials exist on the development PC, so this path has not run against R2 and was not benchmarked. The S3 calls were exercised against local S3-compatible servers (presigned PUT, ETag header, part listing, the completion checks, abort). Those servers do not enforce the signed part length, so whether R2 refuses a wrong-sized part at the link is unconfirmed; the completion check refuses it either way. Before turning it on in production, set it up on development, upload a multi-GB file in the editor, and compare its time with the Worker path.
