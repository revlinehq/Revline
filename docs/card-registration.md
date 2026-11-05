# Reference panel registration (#104)

The original card changes its contents while independently expanding its outer width and height. Registering the seed texture follows the changing interior instead of the container. The previous affine result was also reduced to determinant scale, discarding the measured axis lengths.

The tracker now recognizes a solid dark enclosing silhouette when its seed bounds overlap the selected box by at least 60%. Subsequent frames must overlap the preceding silhouette by at least 50% and retain at least 90% convex solidity. This path is excluded for full-frame camera requests and background-calibrated opacity requests. Other elements retain ECC registration.

`registrationBox` is the measured axis-aligned silhouette extent in source pixels. `corners` records its simplified convex outline; it is evidence, not a perspective transform or a claim of four exact corners. Selection coordinates remain relative to the seed silhouette, so an approximate selection is not silently rewritten. Panel fits use the explicit registration box center and independent bounding-box `scaleX` and `scaleY`; rotation is zero in this representation. These fits reproduce the box envelope, not the perspective of the interior. Existing tracks without independent axes retain uniform-scale fitting. Independently changing channels get separate timing and measured segments when a single easing curve is insufficient.

## Original-source verification

Read incident records v9787jq0m65sg8k7kjcxjj049s8hhcsn and v9739m79dbhejangjprs8j2pds8hgwsw, issue #104, and the saved current-main NDJSON. Baseline is 50dcd98d, including merged #140. Used measured source PTS and full-resolution frames, not contact sheets.

The original request was 3.3–4.3 seconds, selected box (720,510,610,140). All 60 frames now have measured silhouette geometry, including the original loss. The actual silhouette bounds differ from the approximate selection:

| Source time | Left | Top | Width | Height |
| --- | ---: | ---: | ---: | ---: |
| 3.3 | 676 | 481 | 621 | 142 |
| 3.55 | 583 | 411 | 600 | 176 |
| 3.65 (before old loss) | 513 | 376 | 663 | 251 |
| 3.9 | 428 | 224 | 1190 | 759 |
| 4.0 (height extreme) | 429 | 216 | 1207 | 803 |
| 4.283333 | 374 | 193 | 1180 | 801 |

Visually inspected these original 1920×1080 frames. Replayed all ten generated tweens through the installed GSAP and CustomEase runtime at all 60 source timestamps. Maximum center errors were 3.46 px horizontal and 3.50 px vertical; maximum dimension errors were 14.76 px width and 12.20 px height against measured silhouette bounds. At 3.65 seconds the width/height errors were 0.01/3.10 px. These are fit residuals against measured bounds, not independently annotated ground-truth accuracy. The old track froze near (812,821,839,192), outside the expanding panel.

The original title request uses 0.167–0.8 seconds and box (96,150,740,150). Replayed the saved original title video at native 1280×720 with a visible 0.5-second seed; 36 of 37 samples register. Inspected full-resolution frames at 0.2, 0.5 and 0.783333 seconds. The first title line rises and holds; the near-invisible earliest sample remains untrusted. The final rigid-compatible fit produces one title move; replay through GSAP has a maximum vertical residual of 1.71 px against the registered samples. This defect does not reproduce with the current visible-seed registration, so no visibility threshold was relaxed.

The production TypeScript worker parser accepted all 60 original card samples and the shared fitter returned ten moves. Verification creates no test files, fixtures or mocks and changes no shared deployment.
