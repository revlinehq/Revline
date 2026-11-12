import { captionPreset } from './caption-presets';
import { legacyTextFont } from './text-fonts';
import type { Clip, Timeline } from './types';

/** What the deployed media processor lacks: newer fonts (`render:fonts-2`), caption presets (`render:caption-presets`). */
export type LegacyRender = { fonts: boolean; presets: boolean };

/** The timeline as an older media processor can draw it. Fonts: each newer font becomes the older font it names in
 *  `TEXT_FONTS` (Bangers → Anton, Outfit → DM Sans, Rubik and Figtree → Montserrat); such a processor rejects a font
 *  it does not know, failing the whole export or frame read. Presets: the caption keeps its static look and gets the
 *  older karaoke motion the preset names (or none), with capitals written out, since that renderer cannot draw
 *  the preset's own word motion. The saved timeline is untouched; only the copy sent to that processor changes.
 *  Same object when nothing changes. */
export function legacyRenderTimeline<T extends Pick<Timeline, 'clips'>>(timeline: T, missing: LegacyRender = { fonts: true, presets: true }): T {
  const change = (clip: Clip): Clip => {
    let next = clip;
    const font = missing.fonts ? legacyTextFont(clip.fontFamily) : undefined;
    if (font) next = { ...next, fontFamily: font };
    if (missing.presets && clip.captionPreset) {
      const { captionPreset: _, ...rest } = next;
      next = rest;
      // The preset is drawn only over its karaoke template (templateTextProps); otherwise it was inert already.
      const karaoke = next.textTemplate?.preset === 'karaoke' ? next.textTemplate : undefined;
      if (karaoke) {
        const preset = captionPreset(clip.captionPreset.id);
        if (preset.uppercase && next.text) next = { ...next, text: next.text.toLocaleUpperCase('en-US') };
        if (preset.wordBox?.color) next = { ...next, background: preset.wordBox.color };
        const { karaokeStyle: __, ...template } = karaoke;
        next = preset.legacy ? { ...next, textTemplate: { ...template, karaokeStyle: preset.legacy } } : (({ textTemplate: ___, ...without }) => without)(next);
      }
    }
    return next;
  };
  const clips = timeline.clips.map(change);
  return clips.every((clip, index) => clip === timeline.clips[index]) ? timeline : { ...timeline, clips };
}
