import type { EditorSkillPage } from './index';

export const threeScenesPage: EditorSkillPage = {
  name: 'three-scenes',
  description: 'Mix Three.js / React Three Fiber with HTML and GSAP: cameras, lights, primitives, extruded type, GLB/glTF models, frame determinism and CPU export budgets.',
  body: `# 3D inside a scene

Read scene-engine page \`three-craft\` on every 3D build for materials, shaped light, grounding, camera/type composition and licensed models within these renderer limits.

Import \`{ ThreeLayer, Model, Text3D, useThree } from 'revline/three'\`, hooks and layers from \`revline\`, and Three.js classes/types from \`three\`. Three.js loads only for scenes that import it, including their blueprints and transition neighbours. This is React Three Fiber: standard lowercase tags (mesh, group, boxGeometry, meshStandardMaterial, ambientLight, directionalLight) work inside ThreeLayer. HTML, Beat and Layer go outside it. Do not import Canvas, useFrame, controls or arbitrary drei modules. These are authored scenes, not interactive apps.

## One clock for HTML, camera and objects
ThreeLayer is transparent and fills the scene; put an HTML Layer after it for titles. Inside it use \`useTimeline<THREE.Group>((tl, group) => …)\` and attach its ref to a group or mesh. It is the same paused GSAP hook as HTML motion, on the nearest Beat's clock. \`useThree()\` exposes camera and scene. Tween camera.position, camera.rotation, object.position/rotation/scale, material.opacity or light.intensity on that timeline. Rotations are radians. For a camera aiming at a point, use a tween's onUpdate to assign camera.lookAt; also set the initial aim while building. Callbacks must assign absolute derived values, never accumulate movement. Animate a parent group for a loaded model or Text3D.

\`\`\`tsx
import { Layer, useTimeline } from 'revline';
import { ThreeLayer, useThree } from 'revline/three';
import type * as THREE from 'three';
function Product() {
  const { camera } = useThree();
  const ref = useTimeline<THREE.Group>((tl, group) => {
    tl.to(group.rotation, { y: .7, duration: 3, ease: 'power3.inOut' }, 0);
    tl.to(camera.position, { z: 4.8, duration: 3, ease: 'power2.inOut' }, '<');
  });
  return <group ref={ref}><mesh><boxGeometry args={[1.8, 1.8, 1.8]} /><meshStandardMaterial color="#d8bd79" roughness={.65} metalness={.15} /></mesh></group>;
}
export default function Scene() {
  return <Layer style={{ background: '#202020' }}>
    <ThreeLayer camera={{ position: [0, 0, 6], fov: 40 }}>
      <ambientLight intensity={.8} /><directionalLight position={[3, 4, 5]} intensity={2} />
      <Product />
    </ThreeLayer>
    <Layer style={{ padding: 100, fontSize: 72, pointerEvents: 'none' }}>A new perspective.</Layer>
  </Layer>;
}
\`\`\`

## Camera language and lighting
- **Push-in:** ease camera.position.z toward the subject. Keep the focal length (fov) steady for a physical dolly. A slow push gives a hold motion without changing the message.
- **Orbit:** tween an angle on a plain object with GSAP, and assign camera.position to radius * sin(angle), height, radius * cos(angle) in onUpdate, then camera.lookAt the subject. Set the initial pose too. Keep radius and target fixed; do not use OrbitControls.
- **Parallax depth:** place foreground, subject and background at distinct z positions, then truck camera.position.x gently. Close objects travel farther on screen. Keep HTML headlines outside the canvas so they stay readable.
- Start with a soft ambient/hemisphere fill and one directional key above and to a side. An optional weaker rim separates a dark object from a dark background. Keep materials mostly matte. No sparkles; no purple brand fills. Use the project's confirmed colors.

## Models and 3D text
- \`<Model src="https://…/object.glb" />\` loads a CORS-enabled HTTPS GLB or glTF. Use a literal HTTPS URL (or a constant with that literal) ending in .glb or .gltf; query parameters are fine. External buffers/textures resolve relative to the glTF URL. Export preparation copies those resources and literal .json typeface URLs locally so frame capture works offline. Draco, KTX2 and meshopt compressed models are unsupported; export an uncompressed, self-contained GLB instead.
- To use a project model, upload with uploadMedia (contentType \`model/gltf-binary\`), run its returned upload script (prints the completed assetId; up to 32 MB, no finishUpload needed), then attach \`media: [{ name: 'product', assetId: '…' }]\` on addScene/addFilm/editScene. Read \`const { media } = useScene()\`; use \`<Model src={media.product} />\`. Project models must be self-contained GLB files: embed textures and buffers. They remain library assets, not footage clips.
- \`<Model src={…} animation="Walk" />\` evaluates the named embedded animation at absolute beat seconds. Optional \`animationTime\` overrides that absolute time. Never use useAnimations, mixer.update(delta), physics, or a playing clock. GSAP may animate its parent group at the same time.
- \`<Text3D font="https://…/font.typeface.json" size={.5} height={.08} curveSegments={4} bevelEnabled={false}>Depth<meshStandardMaterial color="#f1e6cc" /></Text3D>\` uses drei's extruded geometry. Supply a licensed Three.js typeface JSON (not WOFF/TTF); normal HTML titles use the scene's brand fonts. Wrap the text in a group to animate it. Bevels and dense curves add triangles.
- The composition fetches resource bytes and sends them into the isolated frame. It waits for parsing and textures before acknowledging paint; failures fail the capture rather than silently returning an empty model. Remote resources must remain immutable to match later exports. Prefer project GLB assets for durable work. Record asset/font licenses before using third-party assets.

## Deterministic and practical exports
There is no free-running render loop: frameloop is never; after React commits and GSAP seeks, model animation is evaluated and GL draws once before the frame acknowledgement. Do not create another Canvas, renderer or clock. No useFrame, elapsed/delta time, Date/performance, RAF, timers, controls, animation state, += movement, random calls per frame, postprocessing or time-based shaders. Model and texture loading is readiness work, never animation time. Keep persistent scenes outside Beats when motion spans a cut; offscreen Beats unmount their GL layers.

Preview and CPU Chromium export share the same quality: fixed DPR 1 (ThreeLayer accepts .5–1), antialias off, shadows off, alpha on. Never select quality from devicePixelRatio or export mode. Prefer basic or standard materials; no transmission/clearcoat. Per layer: at most 4 lights, 32 materials, 128 draw calls and 200,000 triangles. Aim below 50,000 triangles and 30 draw calls; reuse geometry/materials or instances, keep textures at 2048 px or below, and avoid large transparent overlaps. No environment maps, reflections or shadow passes by default. Lower DPR deliberately only if the measured export needs it, and inspect its real 1080p pixels.

Verify the first frame, a mid-move and last visible frame; seek forward/backward/repeat to the same times and compare pixels; reload directly at a middle frame. Check HTML and GL stay aligned across Beats, cuts and transitions with getFrames. Export a representative range on dev and record resolution, frame count, CPU profile, seconds per frame and startup overhead. ReadFrames of the resulting MP4 checks the actual encoded output. Follow scene-engine checklist for the rest.`,
};
