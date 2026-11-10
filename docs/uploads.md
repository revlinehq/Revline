# Uploads

How source footage and Cloud storage files reach R2. Code: `lib/editor/multipart-upload.ts` (browser engine), `lib/editor/upload-resume.ts` (resume), `lib/storage/part-links.ts` (link cache), `convex/r2.ts` and `convex/cloudMedia.ts` (leases, links, completion), `cf-workers/media/worker.ts` (`/part`).

## Transfer

A file is sent as an R2 multipart upload in 32 MiB parts (larger only when a file would need more than 10,000). The browser starts with 4 parts in flight and measures total throughput every 2.5 s: a step up is kept when it adds 8%, a step that adds 25% is followed by a doubling, a step that adds nothing is undone and tried again 45 s later, and a failed part halves the count for 30 s. The ceiling is 12 on HTTP/2 or HTTP/3 (the media Worker) and 6 when the protocol is HTTP/1.1 or unknown. Save-Data or a slow `effectiveType` starts at 2 with a ceiling of 4.

Part links come from `partUrls` in batches of up to 64 (the server allows 100) with a look-ahead refill; `partUrl` remains for older clients and the iOS app. Node uploads (`lib/server/upload-media-file.ts`) send 6 parts at once; the MCP local upload script sends 4, streamed from disk.

Measured on a ~500 Mbps+ uplink in headless Chrome (November 9, 2026): 32 MiB parts gave 62 s for 5 GB, 16 MiB the same, 64 MiB about 100 s.

## Interruptions

- Offline or failing requests: each part waits for `online` and retries with backoff (1 s to 30 s). The upload stops only after a part has failed for 15 minutes, with a message that says to add the file again.
- Closed tab, reload, crash, or that 15-minute stop: the browser keeps a note per file in IndexedDB (`revline-uploads`): upload id, part size, and each stored part's etag with the Worker's receipt. Adding the same file again (same name, size, modified time, and a SHA-256 of its first and last 2 MiB) calls `resume`, which checks the lease (same owner, same project, not finished, not expired) and each receipt's HMAC, and returns the parts that count. Only the rest are sent.
- The receipt is an HMAC by the media Worker over key, upload id, part number, size and etag, returned in the `X-Part-Receipt` header. R2's Worker binding cannot list the parts of a multipart upload, so this is how the server knows a part exists without trusting the browser.
- Limits: a project upload lease lasts 24 hours from its start; a Cloud storage upload is cleared after 2 idle hours. After that the file starts over. Resume is per browser profile. Cancelling releases the upload at once.
