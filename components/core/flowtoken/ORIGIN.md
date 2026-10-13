# FlowToken text fade

Source: https://github.com/Ephibbs/flowtoken
Copied from FlowToken 1.0.40, `src/components/SplitText.tsx` and `src/styles.css`.
FlowToken's README identifies its license as MIT; its npm package metadata identifies ISC.
Original author: Ephibbs.

This local adaptation retains stable source keys and the original fadeIn keyframes. React state replaces mutable render-time refs, append detection uses a prefix match, and text can wrap naturally. Received bursts are split at word boundaries and staggered at 30 tokens per second, capped at 180 milliseconds so completed text never waits in a playback queue. Normalized final responses retain unchanged tokens. Historical text skips entry animation, while the final live tokens finish their fade. Only the requested fade effect is included. The adaptation was reused from the user's ViralShark project. There is no runtime FlowToken npm dependency.

The upstream repository does not ship a standalone LICENSE file. The published npm package declares ISC; its license notice is retained in LICENSE alongside this source attribution.
