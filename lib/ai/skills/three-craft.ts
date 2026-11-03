import type { EditorSkillPage } from './index';

export const threeCraftPage: EditorSkillPage = {
  name: 'three-craft',
  description: 'Read on every 3D build: material identity, shaped light, grounding, camera and HTML composition, licensed models, and fixes within the CPU renderer limits.',
  body: `# 3D craft

Read with scene-engine page \`three-scenes\` for mechanics. Design for DPR 1, no antialiasing, no shadows and one GL render per seek. Stay below its light/material/triangle budgets. These are techniques to choose for the subject, not a preset look.

Snippets use React's \`useMemo\`, \`useTimeline\` from \`revline\`, and runtime \`import * as THREE from 'three'\` where needed.

A dev cursor looked like a cutout: uniform white face, thin bevel, no visible side/contact. Expose a side face and contact cue before movement; raising ambient/metalness cannot fix missing form.

## Give each material an identity

Judge a material by its highlight width, dark-to-light range and edge response, not its base color. At the closest 1080p pose, target a 2–4 px projected bevel; inspect a source-pixel export crop with readFrames/measureFrame. Smooth normals remove faceting; they do not antialias silhouettes. Keep some dark surface beside a highlight so the highlight describes curvature.

| Surface | Useful starting range | What makes it read |
| --- | --- | --- |
| Metal | \`metalness .9–1\`, \`roughness .2–.4\` | Colored specular highlights against dark areas. Position the key where the camera sees its highlight. Without an environment, large unlit regions can go almost black. Raising ambient does not supply reflected surroundings. |
| Plastic | \`metalness 0\`, \`roughness .3–.55\` | A colored diffuse body with a restrained, pale highlight. Avoid metallic mid-values as a universal polish slider. |
| Clay / matte | \`metalness 0\`, \`roughness .75–1\` | Broad tonal gradients, rounded edges and contact darkening. Matte still needs a directional key; uniform fill erases its form. |
| Emissive | \`emissiveIntensity .3–.8\` initially | A small luminous inset or face, surrounded by darker material. Standard emissive does not light neighbours and there is no bloom. A white clipped surface is not a glow. |

Ranges are starting points; adjust against the actual lighting and rendered pixels. For example, on different meshes:
\`\`\`tsx
<meshStandardMaterial color="#d7c49a" metalness={.95} roughness={.27} />
<meshStandardMaterial color="#729e7c" metalness={0} roughness={.34} />
<meshStandardMaterial color="#caa785" metalness={0} roughness={.88} />
<meshStandardMaterial color="#dcffcc" emissive="#c0ffac" emissiveIntensity={.6} />
\`\`\`

**Matcaps:** \`<meshMatcapMaterial matcap={texture} />\` supplies a painted studio response without an environment pass. A static canvas painted once in \`useMemo\`, converted to \`new THREE.CanvasTexture(canvas)\` with \`texture.colorSpace = THREE.SRGBColorSpace\`, works. Paint broad light/dark bands with smooth gradients, not tiny white streaks. Matcaps follow view-space normals, ignore scene lights and do not reflect nearby objects. Check them through the intended camera move. Do not use them for a physically changing reflection. Standalone remote texture/HDR loading has no supported readiness/export packaging path; do not import drei Environment, run PMREM/cube captures or invent a texture loader. Embedded GLB textures use Model's resource path.

**Glass and refraction:** transmission and clearcoat are rejected. IOR/thickness cannot restore refraction without transmission, and WebGL cannot refract HTML behind the transparent canvas. Choose an explicitly stylized translucent shell when bending the background is unnecessary. Use a faint tinted center, stronger grazing-angle rim and one broad highlight. Keep to one front-facing transparent surface with \`depthWrite={false}\`; nested shells invite sorting artifacts. This static, view-dependent shader works on a curved mesh (React and THREE imports as in three-scenes):

\`\`\`tsx
const vertex = \`varying vec3 n, eye;
void main() {
  vec4 p = modelViewMatrix * vec4(position, 1.);
  n = normalMatrix * normal; eye = -p.xyz;
  gl_Position = projectionMatrix * p;
}\`;
const fragment = \`varying vec3 n, eye;
void main() {
  vec3 N = normalize(n);
  float rim = pow(1. - max(dot(N, normalize(eye)), 0.), 3.);
  float h = smoothstep(.88, .98, dot(N, normalize(vec3(-.5, .7, 1.))));
  gl_FragColor = vec4(mix(vec3(.28,.5,.43), vec3(.94,1.,.95), max(rim,h)),
                      .08 + .72 * rim + .35 * h);
}\`;
// Inside a mesh. No time uniform, capture, extra renderer or frame loop.
<shaderMaterial vertexShader={vertex} fragmentShader={fragment}
  transparent depthWrite={false} toneMapped={false} />
\`\`\`

This is a Fresnel-like illustration, not optical glass: the highlight is painted in view space and the background stays undistorted. If true refraction is central to the shot, report the engine gap rather than claiming this matches it.

## Shape light and ground the object

Move the key until its highlight reveals the important face and bevel; then add only enough hemisphere fill to retain information on the dark side. A directional light is not an area light: higher roughness broadens its highlight, but cannot produce real soft shadows.

- **Product lighting:** favor a key above and off-axis, subdued fill, and a weaker rear/side rim when the silhouette needs separation. The key should reveal the material rather than wash every face white.
- **Dark studio:** reduce fill relative to key, retain dark bands on metal, and separate the silhouette from the background with the rim. Do not turn the entire outline into a white wire.
- **Soft daylight:** increase hemisphere fill relative to key and reduce rim contrast. Use moderate-to-high roughness for broad response. It approximates open-sky fill, not an HDR window reflection. All three choices use the same ordinary lights, within four per layer; inspect key/fill/rim separately at first/mid/last poses; if faces merge, lower fill before raising metalness.

**Contact shadows / fake AO:** a small dark core at contact plus a wider faint falloff makes weight legible without a shadow pass. Paint a radial alpha texture once; place it on a horizontal world-space plane just above the receiving surface, underneath the object. Keep it in the same world as the model so a camera move preserves perspective. Tight patches at seams fake local occlusion; do not darken the whole scene with ambient light. This is an authored contact cue, not light-dependent AO or a cast silhouette.

\`\`\`tsx
const contact = useMemo(() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 3, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.8)');
  g.addColorStop(.35, 'rgba(0,0,0,.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}, []);
// Receiver at y=0. Match footprint and opacity to the contact, not the screen.
<mesh position={[0, .006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
  <planeGeometry args={[2, 2]} />
  <meshBasicMaterial map={contact} transparent opacity={.65} depthWrite={false} />
</mesh>
\`\`\`

**Depth of field:** there is no depth-buffer DOF, SSAO or postprocessing. Keep the hero sharp; create focus separation with overlap, scale, contrast and distinct z planes. For an intentionally defocused backdrop, a separate HTML background element with \`filter: 'blur(24px)'\` behind ThreeLayer works; keep it small and static. It cannot blur an object according to distance or reproduce lens bokeh. Blurring the whole GL canvas also blurs the hero and its edges.

## Compose the camera with the type

Reserve type space before placing the hero. ThreeLayer is transparent: HTML before it sits behind GL; an HTML Layer after it sits in front. DOM order cannot put letters halfway through a mesh. Keep moving silhouettes ≥24 output px from titles; inspect camera extremes and text contrast ≥4.5:1 with measureFrame. Start with 5–8% frame margins and check the entire camera path. Judge title size at phone viewing size; small decorative labels must not carry the message.

ThreeLayer's perspective \`fov\` is vertical degrees. For product detail, try a narrower 25–40° field and move back to fit; wider fields exaggerate near/far size differences. A lens in mm is meaningless without a sensor size: \`fov = 2 * atan(sensorHeight / (2 * focalLength))\`, converted to degrees. At distance d along the viewing axis, visible height is \`2 * d * tan(fov / 2)\` (radians here), width is that times aspect ratio. Use these to frame the bounding box, including bevels and the final pose. Changing fov alone is a zoom, not a new camera angle.

Aim near the visual center. A slightly elevated camera shows top and side surfaces; too high flattens a tall product. Establish scale with a base/contact plane, believable proportions and repeated elements of known relative size. Foreground overlap and background separation add depth more reliably than gratuitous spinning.

**Purposeful motion:** reveal a specific side, construction detail or depth relationship, then settle long enough to read it. A camera orbit changes parallax; rotating only the object leaves the surroundings fixed. Actual camera position and lookAt changes work, including elevation:
\`\`\`tsx
const { camera } = useThree(); // inside ThreeLayer
const ref = useTimeline<THREE.Group>((tl) => {
  const aim = () => camera.lookAt(0, .75, 0);
  camera.position.set(3, 3.1, 10.8); aim();
  tl.to(camera.position, { x: -1.5, y: 2.6, z: 10.8,
    duration: 6, ease: 'power2.inOut', onUpdate: aim }, 1);
}); // attach ref to a group; initial pose and callbacks assign absolute values
\`\`\`
Camera paths reveal only existing geometry; test requested start/end viewpoints. Flat illustrations have no hidden sides. Refractive chess pieces remain unsupported.

## Source models with provenance

Check the asset-library skill/catalog first for reusable assets. The current dev readSkill catalog has no asset-library entry: say so, inspect existing project media, then use verified external sources if needed. Do not invent library or licensing tools. Record each asset's title, creator, source URL, exact license/version and link, required notices, changes and project assetId in the available library record; if none exists, retain that ledger in the project brief with updateBrief. An internal ledger does not replace public attribution.

- [Poly Haven](https://polyhaven.com/license): CC0 models for realistic subjects; check the download formats and convert to GLB when needed.
- [Kenney](https://kenney.nl/support): CC0 game assets for intentionally simplified subjects; check each pack's formats and license file.
- [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets): direct GLB/glTF downloads with per-model legal sections, including CC0 and CC-BY. For example, [Cesium Man](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CesiumMan) credits Cesium under CC BY 4.0 and separately identifies its logo. Check every contributor, texture and mark; the repository is not blanket CC0.
- For CC-BY models, verify the individual creator's download/license page. “Free download” alone is not a license. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits commercial adaptations with credit: retain supplied creator/attribution parties and notices, source and license links, and state modifications. Carry the credit into the film's credits or accompanying publication where viewers can access it. CC0 needs no attribution, but still record provenance. Check brand/trademark rights separately for branded models.

Before upload, inspect dimensions/up-axis/origin, normals, visible topology, UVs, transparency and every texture/material. Reauthor unsupported transmission/clearcoat materials. Normalize units and transforms; put the contact point at a known local height. Remove invisible internals, unused materials and duplicate textures; decimate unseen curvature before the silhouette, and inspect again at the closest intended view. Prefer a few MB, below 50k visible triangles / 30 draw calls for the whole layer, textures at most 2048 px. A small compressed file can still have enormous geometry or decoded textures. Pack textures/buffers into one uncompressed GLB, below the 32 MB upload cap; no Draco, meshopt or KTX2. Upload and attach with the Model workflow in three-scenes. Check the rendered result after optimization, not just the source viewer.

## Failures to fix in rendered pixels

| Symptom | First correction |
| --- | --- |
| Flat lighting / white cutout | Reduce fill; reposition key; show a side face and a readable bevel. |
| Everything looks plastic | Separate metalness and roughness by material; preserve highlight/dark bands. Do not compensate for missing reflections with generic gloss. |
| Jaggies / crawling edges | Inspect actual 1080p crops. Widen tiny bevels, soften extreme contrast, broaden highlights and remove subpixel details. More segments fix faceting only. No DPR >1, antialias override or FXAA workaround. |
| Fake-looking refraction | Stop claiming refraction. Use a simple tinted/rim shell if the brief permits; otherwise name transmission/refraction as a missing capability. |
| Wrong scale / floating object | Normalize units, align the true lowest point with its receiver and add a contact core. A large detached oval looks like levitation. |
| Camera wanders | Name what the move reveals; reduce travel, keep the aim deliberate and protect type space. Use true camera motion for parallax, not CSS perspective on the canvas. |

Use getFrames for first/mid/last poses and repeat/backward seeks; it returns reduced review images, so inspect source-pixel crops of a 1080p dev export with readFrames and measureFrame for edges, contacts and type. Run checkPacing for motion. Retain honest limits: these techniques improve form and material identity; they do not eliminate the renderer's silhouette aliasing.`,
};
