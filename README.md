# Revline — AI Video Editor

Revline is an AI video editor: add your footage, describe the edit in chat, watch the preview update, and export your video.

The current Revline implementation uses Next.js, Clerk, Convex, Cloudflare R2, and HyperFrames, with Claude calling validated editing tools. The source currently on this branch is the earlier motion prototype; the setup notes below apply to that prototype until the current editor source is published.

## Run

Requires Node.js 22+ and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The development and production scripts bind to loopback because this MVP is intended for personal local use. To run an optimized build:

```sh
npm run build
npm start
```

Keep the `src/remotion` and `src/motion` source directories, `public/audio`, and installed dependencies available to the Node process: video export bundles the composition at runtime. This isn't a static-export app. On the first render, Remotion downloads its headless Chrome browser to `.remotion/`; the machine needs outbound access and Chrome's system dependencies. Standard desktop Linux, macOS, and Windows environments are supported by the underlying renderer.

## AI connection

No key is required to try the editor. The **local demo engine is rule-based**, not an LLM, and its UI is labeled accordingly. It understands commands such as:

- `Create a 20-second launch video for Nova`
- `Make scene 2 last 6 seconds`
- `Change the headline to "A better way to work"`
- `Add a chart scene`
- `Make it portrait`

For free-form AI direction, open **Model settings**, choose OpenAI, and enter an API key and model. The default is `gpt-4.1`, which supports structured output through the Responses API. You can also configure the server:

```sh
cp .env.example .env.local
```

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in `.env.local`, then restart the server. API calls are billed to your OpenAI account. Keys entered in the UI stay in React memory; environment keys stay server-side. Keys are never included in downloaded projects. Requests explicitly use `store: false`. The model receives prompts, recent chat, composition content, the selected scene, and asset names/IDs; this MVP doesn't send image pixels to the model. The app validates structured model output before applying it and never executes model-generated code.

## Included workflow

- Ten scenes: typography, logo reveal, product screenshot, cursor/callout spotlight, feature cards, animated charts, workflow steps, AI composer, result reveal, and closing frame. The opening sample follows an introduction → typed prompt with sideways movement → Send close-up and click → result reveal.
- Dark, Light, and Contrast visual styles, grayscale presets and custom accent colors, and landscape/portrait/square canvases.
- PNG, JPEG, and WebP uploads; logo/screenshot/background roles; per-scene asset assignment. Up to eight images, 5 MB per image, about 15 MB total.
- Reusable [motion library](src/motion/README.md): masked line/word reveals, cubic Bézier and spring easing, camera paths, five transition types, and independent text/shape/image layers with editable keyframes.
- Optional ambient/pulse soundtrack with click and transition sounds; original procedural audio ships with the app.
- Scene copy, duration, motion, content items, and chart values; add, reorder, duplicate, and delete scenes.
- Live playback, scrubbing, fullscreen, scene selection, undo and redo. Space plays/pauses; Ctrl/Cmd+Z undoes; Shift+Ctrl/Cmd+Z redoes outside inputs.
- H.264 MP4 export at 720p and 1080p with progress, cancellation, in-app playback, and an explicit download.
- Optional JSON project download/import, including assets. Nothing saves automatically.
- Responsive panel navigation for smaller screens.

Project and chat state live in browser memory. Refreshing starts a new session. Rendering uses a temporary bundle directory that is removed after success, failure, or cancellation; video bytes return to the browser. Explicit downloads stream those bytes back through a temporary HTTP response for compatibility with embedded browsers; no download is retained server-side. The cached render browser is a development dependency, not project storage.

## Validation

```sh
npm run lint
npm test
npm run typecheck
npm run build
```

With the server running, the integration smoke test renders all ten scene types as one-second scenes and saves an ignored verification video:

```sh
npm run test:render
```

`VERIFY_BASE_URL` can select a different local server. `VERIFY_SHOWCASE=1 npm run test:render` renders the 19-second composer demo with audio. `VERIFY_ASPECT=portrait` or `square` selects a different canvas; `VERIFY_RESOLUTION=1080p` selects Full HD. Unit/API tests check targeted edits, schema limits, external asset rejection, missing credentials, same-origin requests, and an AI response through a mocked HTTP transport. A live AI request requires your own API key and is separate from those tests.

## Scope and next steps

There is no database, authentication, automatic saving, audio editing/upload, arbitrary AI-generated component execution, or 3D compositor. The layer keyframe editor handles 2D position, scale, rotation, opacity, and blur. Moving-layer softening uses a small velocity-based spatial blur, not temporal shutter sampling. Screenshot scenes animate supplied images; the built-in product UI and result are illustrative. This first motion library is ready for feedback on timing and art direction. A hosted multi-user version will need authentication, quotas, isolated/queued render jobs, and a suitable Node rendering environment.

Remotion is source-available under its own license, not MIT. Its current free license covers individuals, nonprofit organizations, and for-profit companies with up to three employees, including commercial video creation. Other organizations need a company license. Review the [Remotion license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) before broader commercial distribution. React/SVG scenes are ordinary components and can be extended without changing the editor's data model where their props fit the scene schema.
