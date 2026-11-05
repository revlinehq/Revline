# Connecting a mobile app to Revline

Revline's existing Convex deployment is the application API for both web and mobile clients. Cloudflare stores and processes media. A mobile app does not need a second backend, a new REST gateway, or direct access to the processing containers.

This is a connection guide for the existing implementation, checked against Convex 1.46.0. No mobile application or device integration has been built or verified yet.

## Environments and authentication

| Client | Convex deployment | Clerk instance |
| --- | --- | --- |
| Local web and development mobile builds | `majestic-alpaca-541` | Development |
| Hosted web and production mobile builds | `different-gnu-398` | Production |

Use the chosen deployment's public Convex URL and the matching Clerk publishable key in the mobile app. Use the same Clerk instance as the website so an existing account retains its identity and projects. Never connect a production build to development data.

For React Native, connect the native Clerk SDK's `useAuth` hook to `ConvexProviderWithClerk` from `convex/react-clerk`. The existing backend expects a Clerk token for the `convex` application, configured in `convex/auth.config.ts`. The provider handles token refresh. Wait for `useConvexAuth().isAuthenticated` before calling authenticated functions. After sign-in, `users.store({})` synchronizes the verified account profile, as the web app already does.

Use the generated references in `convex/_generated/api` and types in `convex/_generated/dataModel`. Those references work with Convex queries, mutations, actions, and reactive subscriptions; they do not depend on Next.js routes or browser cookies. The future mobile build must include those generated client modules in its module resolution. Backend implementation files and server environment files do not belong in the app bundle.

Official setup: [Convex with Clerk](https://docs.convex.dev/auth/clerk), [ConvexProviderWithClerk](https://docs.convex.dev/api/modules/react_clerk).

## Existing application functions

These are Convex function paths, not URL paths. Their arguments and return types come from the generated API; the backend validators remain authoritative.

| Feature | Functions | How the client uses them |
| --- | --- | --- |
| Account | `users.store`, `users.current`, `billing.status` | Synchronize profile and read account/access state. |
| Projects | `projects.list`, `projects.get`, `projects.create`, `projects.update`, `projects.remove` | Read and manage the signed-in account's projects. |
| Timeline | `projects.saveTimeline`, `projects.history`, `projects.undo` | Save validated edits with revision checking and read undo history. |
| Media | `assets.list`, `assets.get`, `assets.library`, `assets.selected`, `assets.remove` | Read owned sources, metadata, analysis and playback URLs. |
| Uploads | `r2.start`, `r2.partUrl`, `r2.complete`, `r2.abort` | Authorize uploads through Convex and send binary parts directly to Cloudflare. |
| Playback | `playback.refresh` | Get fresh signed URLs for the requested owned project assets. |
| AI editing | `assistant.send`, `assistant.status`, `assistant.messages`, `assistant.stop` | Submit a prompt, subscribe to progress and messages, or stop the run. |
| Media processing | `mediaTasks.start`, `mediaTasks.get`, `mediaTasks.list`, `mediaTasks.cancel` | Request supported analysis/preparation and observe saved task status. |
| Video-link import | `mediaTasks.importVideo` | Queue an owned source import from a supported public video URL. |
| Export | `renders.start`, `renders.get`, `renders.list`, `renders.cancel` | Start an MP4 render, observe progress, download its result, or cancel. |
| Storage | `storage.summary`, `storage.files`, `storage.remove` | Read usage, paginate files, and remove eligible owned files. |
| Sharing | `timelineShares.status`, `timelineShares.chatPreview`, `timelineShares.publish`, `timelineShares.revoke`, `timelineShares.get`, `timelineShares.useTimeline` | Publish/update an explicit snapshot, revoke it, view it, or copy it into an owned project. |

Project, media, export and task functions validate identity and ownership on the server. Sending a project ID does not grant access. The app never supplies a user ID to impersonate an owner. Published share lookup is deliberately public; omit `chat` when publishing unless the user explicitly includes selected conversation messages.

The Next.js `/api/analyze`, `/api/extract-audio`, `/api/waveform`, `/api/beats`, and `/api/render` routes are web conveniences with browser-session authentication. A native app calls the corresponding Convex functions above directly. It does not need those cookie-based wrappers to be changed.

## Upload sequence

1. Obtain a local media file through the native picker and read its byte size, MIME type and media kind. Supply readable width/height for video and images, and duration where available. Browser inspection code in `lib/editor/media.ts` uses DOM media elements, so the mobile app supplies native metadata instead.
2. Call `r2.start` with `projectId`, `fileName`, `contentType`, `kind`, `size`, and the metadata. Keep the returned `uploadId`, `partSize`, and `partCount` for this transfer.
3. For each numbered part, call `r2.partUrl({ uploadId, partNumber })`. `PUT` exactly that part's raw bytes to the returned URL. The first part is numbered 1; its offset is `(partNumber - 1) * partSize`. The last part contains the remaining bytes. The HTTP body length must match the part's actual byte length. Do not wrap the bytes in JSON, base64, or multipart form data.
4. Collect each response's `{ partNumber, etag }` and call `r2.complete({ uploadId, parts })` with the parts in order. It returns the saved asset ID. Media preparation runs in the existing worker queue; subscribe to `assets.get` and `mediaTasks.list` for its saved state.
5. On user cancellation or an unrecoverable transfer failure before completion, call `r2.abort({ uploadId })`. A completed asset must not be reported as a failed upload because an optional thumbnail or analysis is still pending.

Read file ranges from native storage rather than loading an entire large video into JavaScript memory. Bound concurrency and retries, and use the server's returned part size instead of duplicating its current value in the mobile app. The existing web uploader uses three parallel parts. Background transfers and recovery after the operating system terminates an app still need a native implementation; this guide does not claim they are supported already.

Signed media URLs are credentials for a particular operation. Pass them through unchanged, avoid logging them, and obtain replacements through Convex when necessary. The media Worker already accepts native requests without an `Origin` header and checks the signed grant. Adding a new browser-hosted origin later requires updating its explicit CORS allowlist; native support does not require a wildcard origin policy.

## Editing and background jobs

`projects.get` returns the timeline and its revision. Save using `projects.saveTimeline({ projectId, timeline, expectedRevision })`. If the user edited a previously read snapshot, the optional `baseTimeline` lets the existing server merge that edit against the latest state. Handle revision conflicts by reading the current project and reconciling the user's intent. Do not blindly overwrite a newer web or AI edit.

Send AI instructions through `assistant.send`. The request can include selected clip IDs, attached asset IDs and the playhead. Model and subscription permissions are enforced by the backend. Subscribe to the project and `assistant.status`; retrieve its conversation through `assistant.messages` with the project-owned `threadId`, pagination and stream arguments. Reuse the installed agent message-stream helpers rather than inventing a second stream protocol.

Start export with `renders.start({ projectId, resolution, fps, quality })`. Current supported values are 720/1080, 24/30/60, and `draft`/`standard`/`high`. The server snapshots the timeline and returns a job ID. Subscribe to `renders.get({ jobId })` for status, progress and the completed download URL. Cancel with `renders.cancel({ jobId })`.

Processing and renders run on the existing workers, independently of the mobile screen. When the app resumes, read the saved project, AI and job state again. Realtime subscriptions are useful while connected; they are not native push notifications or a guarantee that a mobile operating system keeps a socket running in the background.

## What remains mobile-specific

- Native navigation, file picking, metadata reading, video playback, timeline gestures, and local upload persistence.
- Clerk native sign-in configuration, secure session storage, and the mobile app's redirect/deep-link configuration.
- A rendering strategy for interactive previews. The existing HyperFrames preview uses HTML/DOM; the backend export renderer is reusable, but its web editor cannot simply be mounted as a native video view.
- Purchase and account-management UX. Existing Stripe checkout/portal actions return website URLs; native billing and return links need a separate product decision before being enabled in a mobile release.
- Real-device verification of sign-in, multipart uploads, signed URL playback/seeking, concurrent web/mobile saves, reconnecting to running edits/exports, and cancellation.

Keep provider keys, Clerk secret keys, Convex deployment credentials, R2 signing secrets, and processing-worker credentials server-side. A phone needs its signed-in session and operation-scoped URLs, never a worker secret or an admin key.

## In-app model entitlement

Editing access and model access are separate decisions. Existing editing checks still admit trials, complimentary grants and accepted Apple access periods. They do not prove payment for upgraded in-app models. Free, trial and unknown payment states use GPT-6.1 Terra with Low reasoning, including when manual model selection is disabled. An operator-granted Ultra entitlement unlocks models like a paid term; other complimentary grants do not. Deployments with `BILLING_ENABLED` off (development, agent worktrees, self-hosted) meter no one and keep the configured models for every account. Active Stripe subscriptions unlock only within their current term; cancellation scheduled for the end of that term does not remove model access. Past-due and unknown Stripe states do not unlock models.

Apple model access requires a current, unrevoked paid transaction, within both its original expiry and accepted access window. Billing grace alone does not establish a new paid term. Verified Apple JWS price and offer mode establish paid versus free; authenticated Superwall transaction price and trial period facts can establish the same evidence. Evidence belongs to a transaction, never to a different renewal described by a webhook snapshot. Apple evidence wins over Superwall evidence. Missing facts remain unknown.

Legacy Apple rows gain evidence on the next verified transaction sync, notification redelivery or purchase restore. Receipt deduplication still prevents repeating access changes, while allowing payment evidence to be backfilled for that same owned transaction. Do not infer payment from plan, renewal count or expiry. Before rollout, audit active legacy rows for missing evidence and reverify their transactions through the existing StoreKit restore/sync or verified provider redelivery path. This change does not retroactively label those rows paid or mutate subscriptions. Existing editing access continues during reconciliation.

The web composer consumes the same entitlement in both entry points, defaulting to restricted while settings load. Send, queued starts and retries clamp restricted accounts; dispatch and the runner's authenticated model query recheck persisted access. Each provider step checks again and stops if access changed. Every current paid subscription can select every configured in-app provider, including Sonnet and Opus; Ultra is not required for Claude. User-owned external MCP inference does not use this in-app model policy.

Sources: [Apple signed transaction fields](https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload), [Apple offer modes](https://developer.apple.com/documentation/appstoreserverapi/offerdiscounttype), [Superwall verified transaction and snapshot semantics](https://superwall.com/docs/integrations/webhooks/v2).
