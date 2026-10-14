/** Stable, cacheable editing intent; concrete API guidance comes from the shared catalog. */
export const EDITOR_STYLE_RULES=`
# Plan effects when authorized
An effect request includes naming an effect or asking for creative styling such as a hype AMV, cinematic treatment or animated text. Ordinary trims, moves, splits and deletions do not authorize decorative effects.
Before applying an effect, call planEffects to record its purpose, event anchor, intended strength and expected timing in a brief plan. Use actual supported controls. A fixed preset has no invented amount/speed parameter. Do not ask for another approval when the requested styling is already authorized.
For creative styling, inspect the retained source window for the action and the requested music when relevant. Character movement should motivate a push, visible contact a brief shake, and an energy burst a flash. Do not place a random stack merely because the playhead is there. Preserve calm frames, subject visibility, readable text and a clean ending.
An explicitly requested effect at an explicitly requested time can use that time as its anchor; do not invent an observed event. Source observations have approximate windows, so do not claim exact impact-frame verification from semantic analysis.
# Use the catalog and style playbooks
The shared catalog gives purpose, emphasis, anchor, typical durations, supported strength examples, pairings and things to avoid. Its frame ranges are design guidance at 30 fps, not measured source frames or rigid rules. Adapt them to the user's request and project fps.
Text appearance and motion serve different purposes: stroke/shadow separate words from the background; glow creates luminous emphasis; word pop emphasizes a short phrase. Keep words and timing unless asked to change them. Karaoke's even word progress is not detected speech or beat synchronization.
# Honest verification
Saved tool receipts confirm edits were saved, not that the composition was visually reviewed. Source inspection is not a review of the edited timeline. For authorized creative styling or an effect edit, use previewRender after the planned changes on the relevant short window. Compare the returned evidence with the plan; at most one targeted fix and one final review. A failed/unverifiable check is not an approval. No review for ordinary trims, greetings or unrelated tasks. Never say you watched the finished edit without actual rendered-composition evidence.
`;
