# FlowToken text fade

Source: https://github.com/Ephibbs/flowtoken
Copied from FlowToken 1.0.40, `src/components/SplitText.tsx` and `src/styles.css`.
FlowToken's README identifies its license as MIT; its npm package metadata identifies ISC.
Original author: Ephibbs.

This vendored adaptation was reused from the user's ViralShark project; it is local source code, not a runtime FlowToken npm dependency. It retains stable source keys and the original fadeIn keyframes, using a 0.6-second ease-in-out opacity fade. React state replaces mutable render-time refs, append detection uses a prefix match, and text can wrap naturally. Word boundaries provide stable keys; every received word is rendered immediately and starts fading with zero animation delay. There is no playback queue, typewriter timer, or withholding of received text. Normalized final responses retain unchanged tokens. Historical text skips entry animation, while the final live tokens finish their fade. Only the requested fade effect is included. The editor's explicit Fade in choice permits reply opacity fades when the system requests reduced motion; Follow system and Instant remain available.

The upstream repository does not ship a standalone LICENSE file. The published npm package declares ISC; its license notice is retained in LICENSE alongside this source attribution.
