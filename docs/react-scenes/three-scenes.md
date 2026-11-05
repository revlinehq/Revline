# Three.js scenes

Use `revline/three` inside a React code scene. `ThreeLayer` mounts a transparent React Three Fiber root next to ordinary HTML layers. `useTimeline` accepts a ref on either an HTML element or a Three.js group/mesh; all GSAP timelines follow the nearest Beat. `useThree` exposes the camera, so camera and object properties can share the same choreography. The agent guide is `readSkill("scene-engine", "three-scenes")`.

Examples:

- `clips/three-depth.tsx`: three primitives, three lights, a GSAP camera push and object rotation, with HTML type.
- `clips/three-depth-heavy.tsx`: the same scene plus 96 spheres, sharing a material (99 draw calls, roughly 144,000 triangles).

`Model` accepts a literal HTTPS `.glb`/`.gltf` URL or `useScene().media.<name>`. Project models are self-contained GLB assets, uploaded through MCP with MIME `model/gltf-binary`, at most 32 MB; the returned script prints the completed asset ID. Attach that ID with scene media. A named embedded animation is evaluated with `AnimationMixer.setTime` at absolute Beat time. No delta integration. Draco, meshopt and KTX2 are not supported.

`Text3D` uses drei's extruded geometry and a licensed Three.js typeface JSON URL. Normal HTML titles continue to use the scene's fonts. Remote model, buffer, texture and font resources are copied beside the export composition before capture; use literal URLs ending in `.glb`, `.gltf` or `.json`, including constants and query strings. Project assets travel through the existing owned-media download path. Resource errors reject capture.

There is no running R3F clock: `frameloop: 'never'`. Every seek commits React, drains resource work, commits the R3F tree, seeks GSAP, evaluates model animation and renders GL synchronously before acknowledging paint. Tests of repeated, backward and remounted Beat seeks returned identical canvas hashes at identical times. Hardware and software rasterizers and H.264 compression can differ in pixel rounding; the timeline state is identical. The dev MP4 at 1.5 seconds measured SSIM 0.9959 against the local full-resolution capture.

Defaults are fixed across preview and export: DPR 1 (bounded opt-in 0.5–1), antialias off, shadows off, transparent canvas, basic/standard materials. Each layer allows at most 4 lights, 32 materials, 128 draw calls and 200,000 triangles; transmission and clearcoat are rejected. Aim under 30 calls and 50,000 triangles, and keep textures under 2048 px. No postprocessing or interactive controls. The optional renderer is about 1.43 MB raw / 358 KB gzip and is fetched only by scenes using 3D, including their blueprints and transition neighbours. The regular React scene runtime is 233 KB raw / 73 KB gzip.

## Review assets and licenses

The sculpture GLB in the isolated dev review project is an original generated octahedron with an original rotation animation, with no third-party model assets. The source examples use only Three.js primitives. Helvetiker Regular is used only by the model/text review scene via [Three.js's typeface JSON](https://threejs.org/examples/fonts/helvetiker_regular.typeface.json). Its embedded metadata credits MAGENTA Ltd. (2004) and carries the MgOpen font permission notice: use/copy/distribution permitted with the copyright and permission notice, restrictions on the MgOpen name for modifications, and no standalone font resale. No font file is committed; the downloaded JSON retains that notice. The development deployment has no `asset-library` skill (its readSkill catalog rejected that name).
