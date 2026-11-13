# Media processing and exports

Production uses three Railway services: Media Processing, Video Export, and Ultra Video Export. Convex owns task claims, leases, progress, cancellation, account seats, and retries. Cloudflare R2 holds media; the frontend and agent runner remain on Cloudflare.

## Runtime images

The Dockerfile packages a full `railway-processor` target and a lean `railway-exports` target. The full processor includes FFmpeg, Chromium, Python trackers, CPU Torch, the checksum-pinned Beat This model, PySceneDetect, and yt-dlp. Export services omit the analysis models. The default `processor` target remains available for the Cloudflare container backend.

Railway services use unprivileged ephemeral scratch, authenticate against their selected Convex deployment, process one task at a time, and exit after the configured idle period. Enqueueing work wakes the matching service. Standard and Ultra queues retain separate account seats and worker pools.

Import checkpoints live under `TMPDIR/revline-imports-v1` (the OS temporary directory when `TMPDIR` is unset), scoped by backend and task. Railway sets `TMPDIR=/tmp/revline`, owned by the runtime user. Checkpoints survive process retries within the same container; container replacement can discard them. The application directory does not need write access.

## Capacity

Permanent service CPU and RAM limits are managed in the Railway dashboard. The entrypoint derives native thread budgets from the actual container allocation. Worker counts use these optional backend settings:

- `MEDIA_PROCESSOR_MAX_WORKERS`: defaults to 4, range 1–8.
- `EXPORT_MAX_WORKERS_STANDARD`: defaults to 10, range 0–100.
- `EXPORT_MAX_WORKERS_ULTRA`: defaults to 10, range 0–100.

A zero export pool limit holds that lane. New capacity settings take precedence over the legacy deployment variable names; existing settings remain effective during adoption. The persisted dispatch-lock table keeps its original name to preserve outstanding locks.

Distributed exports are disabled on Hobby. When enabled in the verified manifest, Railway chunk workers use the separate bounded chunk resource contract. They require supported private image pulls and matching staging job evidence. Single-worker export does not require those image pulls.

## Development and releases

Local development uses `npm run dev:isolated` in an agent worktree. It starts the frontend and local media worker against a scoped development backend. See [isolated development](../docs/isolated-development.md).

Hosted releases use explicit manifests and separate environment files, runtime preflight, authenticated queue verification, and real staging jobs before production promotion. See the [Railway hosting runbook](../docs/railway-worker-migration.md). No release command runs during install or build.

## Emoji in text

No text font has emoji and the image has no system emoji font, so every text font family carries a second face, `public/fonts/noto-color-emoji.woff2` (Noto Color Emoji, COLRv1, OFL), limited to emoji code points (`lib/editor/text-fonts.ts`). Frames and exports, and the preview in Chromium browsers, therefore draw the same colour emoji; a browser that cannot draw COLRv1 (Safari) previews with its system emoji. Characters a text font has itself (♥, ☀) stay in that font. Frames cached before the processor had the font keep their box until the timeline changes. A processor with it reports `render:emoji`; until one does, an edit whose text has an emoji returns an `emojiNote` saying frames and exports will show a "NO GLYPH" box. Keycap sequences (1️⃣) are not covered.

## Video-link imports (yt-dlp)

The image bakes the yt-dlp pinned in `scripts/video-import-requirements.txt`; `npm run video-import:install` installs the same file into `.data/video-import` for local development. Because sites change faster than images are promoted, the processor (`VIDEO_IMPORT_AUTO_UPDATE=1` in the Dockerfile) installs the newest yt-dlp release into its scratch directory at start and once a day, loads it ahead of the baked copy, and keeps the baked copy if that fails. Set `VIDEO_IMPORT_AUTO_UPDATE=0` on the service to stay on the pin. The version in use is logged as `video-importer-ready` and appears in failure messages.

Links are limited to sites with their own extractor (`--use-extractors default,-generic`) that `lib/editor/video-link.ts` recognises, or a direct video file fetched from a checked public address. One import brings in at most three hours (`MAX_IMPORT_SECONDS`): a longer video is refused with a message asking for a `start`/`end` range. Ranges are cut on the exact frame. A Twitch VOD does not go through yt-dlp's downloader (ffmpeg cannot seek into a long playlist of fMP4 segments: it crawls from the start and writes an empty file): yt-dlp only resolves the rendition's playlist, the importer writes a playlist of just the segments the range covers, and ffmpeg reads that, re-encoding with x264 `veryfast` up to three minutes and stream-copying from the keyframe before the start (at most about two seconds early) above that. Progress follows the media written. A Twitch VOD whose broadcast is still live imports by range once that part has aired. Twitch clips and the newer sites are reported at sign-in as `import:twitch-clips` and `import:more-sites`; Convex refuses those links with a plain message while the deployed processor has not reported them.

When a site refuses a download (HTTP 403, "Sign in to confirm you're not a bot", an empty Instagram response, a blocked TikTok address, no usable format), the importer tries the next strategy instead of repeating the same call. Without a proxy: default, IPv4 with single-threaded fragments, then the YouTube clients `web_embedded`, `web_safari` and finally `mweb,tv_simply,android` (360p only). The strategy that worked for a site goes first for that site's next import on that worker. Worker logs name the site and each refused strategy with yt-dlp's own error line, with the proxy URL redacted.

Hosting addresses (Railway, Cloudflare) are refused by YouTube whichever client asks, and Instagram and TikTok treat them the same way. The same image downloads from a residential connection, so production needs:

- `VIDEO_IMPORT_PROXY`: a residential or ISP proxy URL (`http://user:pass@host:port`) passed to yt-dlp as `--proxy`. With it set, each import makes one direct attempt (a proxy success is not remembered, so this stays true) and then goes through the proxy (default formats, then YouTube `web_safari`, then 360p mobile). Proxies bill per gigabyte, so only refused downloads use it. `railway-workers.mjs stage` forwards it to processor services when it is set. Without it, a fully refused import logs that the variable is unset.
- A YouTube or Instagram cookies file (`--cookies`): not wired. Public posts download without signing in through a residential address; a signed-in account risks being banned.
- Downloading in the user's browser or desktop app and uploading the file, which is what the failure message asks for.
