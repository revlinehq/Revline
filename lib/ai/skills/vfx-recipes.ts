import type { EditorSkill } from './index';

export const vfxRecipes: EditorSkill = {
  name: 'vfx-recipes',
  description: 'Proven combinations of the VFX tools: freeze-frame callouts, speed ramps into smooth slow motion, text behind a person, footage through text, tracked labels, tracked spotlights and blurs, beat pulses, mask reveals, and which transition fits which cut. Read for any creative styling, "make it pop", a named effect combo, or before placing transitions.',
  get body() {
    return `# VFX recipes

Each recipe is a sequence of tools. Inspect the footage first (inspectAssetAnalysis, readFrames) so every effect lands on a real moment, then check the result with getFrames. One hero effect per moment; a stack of effects reads as noise.

## Freeze-frame callout
The classic "that's me" or punchline beat.
1. freezeFrame on the reaction or punchline frame, mode insert, 1 to 2 s. Use mode hold instead when the speech must keep playing over the still.
2. A caption or label on the still's time span (start = the freeze time, duration = the freeze length) with a pop-in animation.
3. animateClip on the returned stillClipId: a slow push in, scale 1 to 1.1 over the freeze, ease-out.
4. Optional: setVisualEffects on the still only (colorGrade saturation .2 for a desaturated "record scratch" look) and a generated impact or riser sound (music-and-sound skill).

## Speed ramp into smooth slow motion
For action: a jump, a trick, a pour, a punch.
1. Find the peak moment in the source (readFrames momentsOnly, then fps 10 over the candidate).
2. setSpeedRamp with preset hero (fast, slow at the middle, fast) or bullet (near freeze at the middle), or custom anchors so the slowest point sits on the peak. Leave room after the clip: a ramp can make it longer.
3. smoothSlowMotion on the same clip when its slowest point is .5x or slower on fast motion, so the slow part plays fluidly. It runs in the background and switches the clip after the turn.
4. Optional: a whoosh into the slow part and a hit at the peak; setMotionBlur is not needed on footage.

## Text behind a person
Words between the subject and the background.
1. duplicateClips the footage clip to the same time, so the copy sits on a V layer above it.
2. removeBackground on the TOP copy (person cut-out; Ultra plan, background job).
3. The text on the V layer between the two copies: big, bold, placed where the person partly covers it (behind the head or shoulders).
The cut-out switches in after the turn, so tell the user the layering finishes in a minute or two.

## Footage through text
A word filled with the video, often for titles.
- setMask with shape text on the footage clip (the word, sized wide), with a dark or blurred copy of the footage or a solid below. Keyframe the mask width/height for a zoom-through-the-letters reveal.

## Tracked label or sticker
A name tag, arrow or emoji that follows a person or object.
1. Footage must have fixed framing (no camera motion, subject-follow or keyframes on it).
2. Add the text or image overlay for the time it should follow.
3. attachToTrack mode move: target subject for a person; for any other object, inspectFrames boxes give points.
4. offsetY about -.12 puts a label above a head; keep it inside the frame.

## Tracked spotlight or privacy blur
- Spotlight: duplicate the footage above itself; darken or desaturate the LOWER copy (colorGrade exposure -1, saturation .3); attachToTrack mode mask on the TOP copy with an ellipse and feather 40.
- Privacy blur: duplicate above; softBlur 25 on the TOP copy; attachToTrack mode mask on it with a box over the face or plate.

## Beat pulses
Visuals that breathe with music (music-and-sound skill for finding the song).
- B-roll and montages: setAudioReactive mode beats, scale .05; add glitch.intensity .5 or colorGrade.exposure .3 on accents for drops.
- Text: scale .06 on beats; never shake text you need to read.
- Talking heads: at most scale .03 on downbeats, or none; shaking a speaking face distracts.

## Mask reveals
- Wipe-in: setMask rectangle keyframed from width .01 to 1 with feather 30.
- Iris to a subject: ellipse keyframed from small at the subject to beyond the frame.
- Picture in picture that grows: rectangle with radius .08, keyframed from a corner box to full frame.

## Which transition fits which cut
Most cuts need no transition. Use one for a change of place, time or topic, at most about one every 5 to 8 seconds, and keep one family per video. Never on jump cuts inside one talking-head shot.

| Cut | Transition |
|---|---|
| Time passes, calm story beat | crossfade |
| Dream, memory, soft mood | blur-dissolve, or film-burn for vintage |
| Energetic place or topic change | whip-pan (match the direction of motion in the shots), .3 to .5 s |
| Drop, reveal, push into the next scene | zoom-through on the beat, .4 to .6 s |
| Hype montage | spin-zoom |
| Playful reveal from a point | iris-wipe centered on the subject |
| Clean section change in tutorials | gradient-wipe |

Place a transition's middle on the beat when music plays (addTransition is centered on the cut).
`;
  },
};
