# Audio asset tools

These manual tools preserve the source of the stock audio and support uploads to a separately configured media gateway. The app and release pipeline do not run them.

- `node scripts/archive/author-stock-audio.mjs`: regenerate Revline originals with FFmpeg.
- `node --import tsx scripts/archive/upload-stock-audio.mjs ...`: upload catalog assets using an explicitly selected environment.
