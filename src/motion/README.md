# Frame motion library

Our own React/SVG motion system, with Remotion providing the frame clock, player, audio, and video export. Every pose is a pure function of frame: seeking backward produces the same shot as rendering forward. No CSS animation clocks or DOM mutation are used in the film.

## Composition

`Film` accepts a validated `Project` and uploaded `Asset[]`. It assigns a nominal start to each scene and renders the previous shot briefly underneath the incoming transition. Duration and storyboard selection stay aligned. Transitions are limited to a third of either adjacent shot.

The included composer shot is a coordinated six-second sequence: entrance, typed prompt, lateral move, camera focus on Send, cursor click, then handoff to the result shot. Its subtitle supplies the typed prompt. Camera strength controls the punch-in; Static disables it. Other scenes reuse the same typography, layers, and camera primitives.

## Primitives

| Module | Responsibility |
| --- | --- |
| `core/easing.ts` | Cubic Bézier inversion, cinematic/ease-out/linear curves, spring easing |
| `core/keyframes.ts` | Multiple interpolation segments and holds; normalized full-pose keyframes |
| `core/timeline.ts` | Cut, dissolve, wipe, push, zoom; stable scene starts and bounded overlap |
| `components/layer.tsx` | Position, pivoted scale/rotation, opacity, explicit blur, optional movement softening |
| `components/typography.tsx` | Deterministic approximate text measurement, wrapping, masked lines, staggered words |
| `components/camera.tsx` | Static, push/pull, pan, and focus camera transforms |
| `components/background.tsx` | Plain, grid, outlined orbital shapes, or an uploaded background image |
| `components/custom-layers.tsx` | Independent text, rectangle, ellipse, and uploaded-image layers |

A layer uses normalized x/y and dimensions; 0.5 means half the canvas. Keyframe `at` uses 0–1 of the scene's duration and must increase strictly. Each key contains x, y, scale, rotation in degrees, opacity, blur, and the easing used to arrive at that key. Endpoints hold outside their range. This supports entrance → hold → exit without extra per-layer clocks.

```tsx
const keys = [
  { at: 0, x: .08, y: .9, scale: 1, rotation: 0, opacity: 0, blur: 8, easing: 'cinematic' },
  { at: .25, x: .08, y: .8, scale: 1, rotation: 0, opacity: 1, blur: 0, easing: 'cinematic' },
  { at: 1, x: .08, y: .8, scale: 1, rotation: 0, opacity: 1, blur: 0, easing: 'linear' },
] satisfies PoseKeyframe[];
```

`schema.ts` bounds the model/editor data. `assertProject` upgrades older projects and checks IDs and keyframe order; routes check every image reference before rendering. The AI selects scene types and data; it never writes executable components.

## Extending it

Implement a scene as a component receiving `SceneContext`; use its frame and duration with the primitives. Register its type in the project schema, default scene content, film dispatch, and editor labels. Keep viewport units normalized through the 720×1280 portrait, 960×960 square, and 1280×720 landscape design spaces. Add behavior verification for timing math and render a short example before exposing new controls.

The current blur is spatial, not a physically sampled shutter. Camera movement is 2D. Font metrics are approximate Arial metrics; more precise font-specific layout and temporal motion blur can be added at these seams.
