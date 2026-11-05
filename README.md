# Revline

An AI video editor with a chat assistant, editable timeline, media analysis and background video exports. Built with Next.js, shadcn/ui, Clerk, Convex, Cloudflare R2 and HyperFrames.

## Features

- Edit video, images, text, captions and audio on a shared timeline.
- Describe changes in chat and inspect the saved result in the editor.
- Find clips, transcribe speech, inspect source frames and build motion scenes.
- Process media and render exports through durable background jobs.
- Keep projects and media scoped to authenticated owners.

See [features](features.md) for more detail. Availability depends on your configured providers and deployment.

## Requirements

- Node.js 22 and npm.
- Your own Clerk application and Convex development project.
- FFmpeg and the Python runtimes required by the media features you enable.
- An R2 media gateway and signing configuration for private uploads/playback.
- Your own AI provider credentials for model-backed features.

Hosted Revline credentials, signing keys and production infrastructure are not included.

## Run locally

```sh
npm ci
cp .env.example .env.local
```

Fill in your own development settings using [.env.example](.env.example). Configure Clerk's Convex JWT template and the matching Convex auth issuer. Keep server and worker secrets out of `NEXT_PUBLIC_` variables.

Start your Convex development deployment:

```sh
npx convex dev
```

In another terminal, start the frontend and development media worker:

```sh
npm run dev -- --port 3001
```

Open http://localhost:3001. Configure the worker dependencies described in [media worker setup](infra/media-worker/README.md) before processing footage. Check both web and worker readiness in the terminal.

For parallel agent checkouts, use [isolated development](docs/isolated-development.md) and `npm run dev:isolated`. Never use a contributor checkout to deploy shared or production backends.

## Verify changes

```sh
npm run typecheck
npm run build
```

The project intentionally has no test suite. Inspect the relevant running behavior and actual media output. See [contribution guidance](CONTRIBUTING.md).

## Architecture

Next.js serves the editor. Convex stores owned project state and coordinates durable jobs. Clerk supplies identity. The media gateway signs access to private R2 objects. Background workers run media tools and render frozen timeline snapshots. HyperFrames provides HTML/GSAP playback and rendering.

Deployment roles and credentials are separate. Use your own infrastructure and explicitly select each deployment target. The included self-hosted release workflow is specific to the maintainers' infrastructure and must be adapted before enabling it in a fork.

- [Editor skills and workflows](lib/ai/lanes/README.md)
- [Reference footage](docs/reference-footage.md)
- [Scene rendering](docs/react-scenes/README.md)
- [Media workers](infra/media-worker/README.md)
- [Mobile backend integration](docs/mobile-backend.md)
- [Observability](docs/observability.md)

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Do not include credentials, signed URLs, private media or raw production logs in issues. Dependency audits and redacted Git-history scans run in the security workflow.

## License and assets

Revline-authored code is licensed under [Apache 2.0](LICENSE). Third-party code, fonts, models, sounds and footage retain their original licenses. See [NOTICE](NOTICE), [third-party attribution](third-party/README.md), [font licenses](public/fonts/README.md) and [media provenance](assets/landing-media/README.md).

The code license does not grant rights to third-party footage, music or trademarks. **Public distribution is pending the remaining media-rights and history review** described in [publication readiness](docs/open-source-readiness.md).
