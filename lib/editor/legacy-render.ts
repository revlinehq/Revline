import { legacyTextFont } from './text-fonts';
import type { Timeline } from './types';

/** The timeline as a media processor built before the newer text fonts can draw it: each newer font becomes the
 *  older font it names in `TEXT_FONTS` (Bangers → Anton, Outfit → DM Sans, Rubik and Figtree → Montserrat).
 *  Such a processor rejects a font it does not know, which would fail the whole export or frame read.
 *  The saved timeline is untouched; only the copy sent to that processor changes. Same object when nothing changes. */
export function legacyRenderTimeline<T extends Pick<Timeline, 'clips'>>(timeline: T): T {
  if (!timeline.clips.some(clip => legacyTextFont(clip.fontFamily))) return timeline;
  return { ...timeline, clips: timeline.clips.map(clip => {
    const fallback = legacyTextFont(clip.fontFamily);
    return fallback ? { ...clip, fontFamily: fallback } : clip;
  }) };
}
