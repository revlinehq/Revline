# 3D craft verification, 2026-11-02

The live guidance is `readSkill(name: "scene-engine", page: "three-craft")`. Existing skill bodies have only added links; renderer code is unchanged. This receipt records evidence and limits without adding a reusable scene recipe or test code.

## Cursor diagnosis

Inspected the existing dev project `j97cwa687t43cxprwqg2d9wxx98het80`, explicit tab `main` (project title "3D cursor", tab name "Timeline 1"), revision 3. No scene, timeline or brief edits were made to it. `getFrames` at 1, 3.8, 5.25 and 8.5 s shows the large white front face, narrow dark bevel and no grounding. Source inspection confirms ambient intensity 1.05, a frontal directional key at 2.5, and intermediate metalness on both cursor surfaces. These observations support reducing fill and exposing useful side/depth information, rather than adding generic gloss. Simultaneous object/camera movement changes apparent depth little because the dominant front face remains broad and nearly uniform. Type is readable; its existing left margin is not the main failure.

Both the cursor and proof were exported through Revline at 1920×1080 / 30 fps and uploaded as review sources in the throwaway project. `readFrames(count: 1)` and source-pixel crops inspect the encoded result. `measureFrame` reads the original 1920×1080 pixels, not coordinates inferred from reduced sheets:

| Source | Time | Pixel positions | Measured colors |
| --- | --- | --- | --- |
| Cursor face | 3.8 s | (890,360), (940,480), (1000,550) | `#dcdcd9`, `#d3d3d0`, `#d1cfcd` |
| Proof revision 5, highlight/body/underside | 4.5 s | (930,425), (1000,530), (970,625) | `#dadbcf`, `#597d56`, `#1e3823` |

The cursor's thin contrast edges visibly step. The proof's curved silhouettes still alias too. Material/light choices improve form but do not supply missing antialiasing. `getFrames` describes 720p capture, but the current worker reduces returned review JPEGs to 768 px wide; those are composition evidence, not native pixel measurements.

## Isolated proof

[Open the dev proof](http://localhost:3001/editor/j97b7ycvypstnszym341ka03v58hfjvg), explicit tab `main`, scene clip `164d6ad6-5593-49e8-8731-01fc343bb953`, revision 5, 8 seconds. This is a separate project created for this task. No sound was generated: the authorized artifact is a renderer/material study for skill validation, not a finished branded film.

| Guidance | Evidence in the running scene |
| --- | --- |
| Metal, plastic, clay | Standard materials with metalness/roughness .95/.27, 0/.34 and 0/.88. The torus has colored highlights/dark bands; plastic has a colored body/pale highlight; clay knot has a broad matte response. |
| Emissive | Small standard-material inset at intensity .6, visibly luminous without claiming neighbour illumination or bloom. |
| Matcap | Original 128×128 CanvasTexture painted once with broad gradient bands, sRGB, meshMatcapMaterial. It ignores changing light levels, as the guidance states. |
| Translucent shell / Fresnel-like rim | Static view-space shader, front faces, transparency and depthWrite false. The small solid sphere behind it remains visible and undistorted. No refraction, transmission, extra render or clock is used. |
| Lighting | Four ordinary lights maximum. Off-axis key, subdued hemisphere fill, rear rim and weak front fill. GSAP changes the key/fill/rim balance from 4/.28/2 to 2.8/.85/.7, demonstrating studio contrast and a softer daylight approximation. Product lighting uses those same supported controls. |
| Grounding / fake local AO | Small radial alpha contact patches on pedestal tops plus broad floor patches. All are horizontal world-space meshes, slightly offset from receivers, using basic transparent materials with depthWrite false. Camera motion preserves their perspective. This is authored occlusion, not a shadow or SSAO pass. |
| Focus separation | Distinct z planes, overlap, relative scale and low-contrast backdrop. One small static blurred HTML backdrop sits behind the GL layer; no depth-dependent blur is claimed. |
| Camera / HTML composition | A 32° vertical fov; actual camera x moves 3 to -1.5, y 3.1 to 2.6, with z 10.8 and absolute lookAt(0,.75,0). Different objects reveal/occlude one another as viewpoint changes. HTML title/footer remain outside GL in reserved areas. |
| Model workflow | Original self-contained GLB, 15,000 bytes, 256 triangles, one standard material, known bottom at y=0. Uploaded with model/gltf-binary, attached as scene media, rendered with Model three times. No unsupported compression or physical-material extensions. |

Final `getFrames` inspected 0, 1/60, 2.5, 4.5, 6.5 and 7.9833 s. A separate `[4.5, 1, 4.5]` request returned identical image bytes for both 4.5 s seeks. The capture sessions initialize directly at requested middle times. Final `checkPacing`, ID `ph7dq0f0knmsvyjznseq4bayz98hf95v`, sampled 80 frames at 10 fps and returned no flags. No camera controls, useFrame, animation timers or postprocessing were introduced.

## Assets and licenses

The pedestal, all other geometry, contact textures and matcap are original work from this session. The reusable pedestal is dedicated under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), asset ID `j57ervsdff9gd57gxw51w51yzs8he3hn`; its creator, license link, dimensions and provenance are retained in the proof project's brief. No third-party model or typeface was used. Source authoring created only the original GLB and scene outside the repository; video inspection used Revline's tools. Download/upload scripts only transferred Revline exports.

Source recommendations were checked against [Poly Haven's license](https://polyhaven.com/license), [Kenney's asset license guidance](https://kenney.nl/support), individual [Khronos sample asset legal sections](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CesiumMan), and the [CC BY 4.0 terms](https://creativecommons.org/licenses/by/4.0/). A model's complete contributor/texture/license history matters: a permissive conversion credit does not override an earlier noncommercial license. No downloaded model was used to imply a blanket license for a catalog.

## Engine follow-ups

| Capability | Why it remains a follow-up |
| --- | --- |
| HDR/environment maps and reusable remote matcaps | The public scene module has no supported texture/environment loader. Resource readiness and offline export preparation cover model dependencies and typeface JSON, not standalone HDR/image maps. Add a supported asset/resource path and measure its CPU cost before recommending it. The painted CanvasTexture matcap already works. |
| Physical glass, refraction, clearcoat | ThreeLayer explicitly rejects nonzero transmission/clearcoat on physical materials. A shader shell cannot bend the background or HTML. This also explains the refractive-glass part of Terra's chess problem. |
| Antialiasing / supersampling | ThreeLayer fixes antialias false and clamps DPR to .5–1 for CPU export parity. There is no supported quality override; geometry density cannot resolve silhouette sampling. |
| Depth DOF, SSAO, bloom | No postprocessing or depth-buffer effect API exists. Authored contact patches and background blur are limited visual approximations, not substitutes for those capabilities. |
| Asset-library discovery / license fields | `readSkill(name: "asset-library")` is rejected by the current catalog. Guidance directs agents to check availability, report the gap, reuse project assets and record provenance in the brief with the existing updateBrief tool. It does not invent a library API. |

True camera position/elevation/aim changes are already supported and demonstrated. No general camera engine follow-up is needed for Terra's chess observation; a flat illustration still lacks geometry for a new viewpoint.
