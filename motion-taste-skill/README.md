# Motion taste proof

Throwaway development project: j97c2fy8ezt3vt95ck45hjffjn8hh63e.
Editor: http://localhost:3001/editor/j97c2fy8ezt3vt95ck45hjffjn8hh63e

Brief used by the coding agent: make an original five-second title scene with “Make room.” and “For what matters.”, without a reference, product claims or external assets.

This is an illustrative same-session comparison by the implementing agent, not an independent blind evaluation or a measurement of agent-wide improvement. The baseline was saved before authoring/loading the taste page, using existing motion-design, GSAP revline, scene-engine react-scenes/checklist and overall-styling guidance. The agent had already read the user's task and Terra's study notes, so this is not a clean ablation of those influences.

Before: timeline main, scene revision 1. Ordinary centred title, underline, subtitle and ambient drift. Frame times: 0, 1/60, .7, 1.5, 3, 299/60.
After: timeline 999f065b-04ff-43aa-947c-8105943df1e0, scene revision 4. New taste page loaded with readSkill from dev. Words separate to make space for the smaller message; locked camera and final hold. Frame times: 0, 1/60, .7, 2.3, 3.2, 299/60.

All PNGs are actual saved-timeline getFrames results, unmodified. getFrames returns reduced 720p review images; no pixel measurements were inferred from them. No UI page was changed by this skills-only PR. No exportVideo, stock assets or existing user project edits were used.

Critique: the first after version made the centre phrase too small and allowed insufficient recognition before separating. A scoped patch enlarged the phrase from 34 to 44 and delayed the separation from 1.2 to 1.8 seconds. Final frames show the larger phrase, clean type clearance and unchanged held ending. The first two near-black frames are intentional pre-entrance frames.

Validation: npm run typecheck and npm run build passed on this branch. readSkill motion-design/taste returned the complete page from dev. Before checkPacing had no flags. After checkPacing retained a short-hold flag at .1–.7 seconds within the single title entrance; deliberately retained as one continuous reveal, followed by recognition from .75 to 1.8 seconds and a final hold from 3.1 to 5 seconds. No source exists for readFrames/compareMotion; those tools were not applicable to this original scene. inspectTimeline: one five-second clip per tab, no gaps, overlaps or missing media. Both proofs are intentionally silent title studies.

Dev verification used a temporary deployment snapshot preserving the already deployed image-generation work from generate-image-tool (90bebb0) plus these skill changes. A direct branch deploy had been rejected because the shared dev assets schema already includes imageGeneration. No production deploy occurred. The local npm run dev services are running at localhost:3012; both web and media-worker readiness were verified. No test-only code was created.
