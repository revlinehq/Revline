# Future features

Planned work after the video-editing MVP. This roadmap records product direction; it does not describe features already available or commit to release dates.

## Product direction

Pivot from a VFX-led editor toward agent-first professional motion design and video editing. Users describe their intent; the agent plans and executes coherent typography, layout, motion, timing and visual style. VFX remain supporting tools for that direction.

Keep generated results editable through the same timeline and controls as manual work. Build on reliable cuts, speech preservation, audio sync, subtitles, playback, saving and export before expanding the creative workflow.

## Personalized style generation

Generate custom color grading, motion graphics and subtitle designs from each user's brief, footage and brand preferences. The agent should compose an editable design using supported controls and motion primitives, rather than depend on choosing a named style preset.

- Coordinate colors, typography, layout, animation curves and timing across an edit.
- Let users refine specific details through chat or manual controls without rebuilding unrelated work.
- Save approved styles and user preferences for reuse and consistent future edits.
- Evaluate quality on real footage, including readability, motion continuity and preview/export consistency.

Example: “Warm film colors, minimal captions and smooth text entrances” produces a custom, adjustable combination of grading, subtitle styling and animation.

This follows the core editing foundation. Consistent quality and accumulated user preferences are potential sources of defensibility; generation alone is a product capability, not an established moat.

## Agent memory across projects

Remember each user's preferred editing style throughout Revline: pacing, cut rhythm, caption design, color treatment, typography and motion intensity. Reuse approved styles and learn preferences from explicit feedback and accepted revisions, while keeping project-specific instructions scoped to their project.

Apply relevant preferences to later edits and new projects without making users repeat their brief. Let users review, correct and forget saved preferences, and let the current request override their usual style. Keep each user's memory private to their account.

## Motion design from scratch

Let users start with a blank canvas and create an animated composition in Revline, with manual controls or AI. Uploaded footage should be optional.

### What users can create

- Animated titles, typography, and lower thirds.
- Logo reveals, intros, outros, and product announcements.
- Shapes, callouts, diagrams, and simple animated charts.
- Reusable motion graphics that can stand alone or join a video timeline.

### Editing experience

1. Start a blank composition and choose its dimensions and duration.
2. Add editable text, shapes, images, or imported graphics.
3. Animate position, scale, rotation, opacity, and supported appearance controls with keyframes and easing.
4. Group layers, arrange scenes, and synchronize animation with audio.
5. Preview, revise, save reusable designs, and export the result.

AI-created motion designs should remain editable through the same controls as manually created designs. Users should be able to ask for a change to one layer without rebuilding the entire composition.

### Shared engine and controls

- Extend Revline's existing project model, timeline, selection, undo, and persistence.
- Keep one animation clock and shared composition logic for preview and export.
- Reuse the existing slider, color, text, transform, and animation controls.
- Give manual editing and AI tools the same validated scene and animation operations.
- Define reusable motion primitives and presets in shared catalogs rather than copying implementations into individual templates.
- Evaluate HyperFrames' composition and animation capabilities before building additional rendering systems.

### Proposed delivery stages

1. **Foundation:** blank compositions, text and shape layers, transforms, and basic keyframes.
2. **Composition:** groups, scene sequencing, masks, easing controls, and audio synchronization.
3. **Reusable designs:** saved compositions, editable templates, and shared brand settings.
4. **Advanced motion:** evaluate SVG path animation and morphing, Lottie, and 3D elements when concrete user needs justify them.

### Release checks

- Every supported AI action has a matching manual operation and is undoable.
- Editing one layer preserves unrelated layers and animations.
- Seeking, restarting, and exporting produce consistent animation states.
- Preview and exported video agree on framing, timing, text, and appearance.
- Real motion-design projects pass playback, export, and agent-tool tests before release.
