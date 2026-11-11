'use client';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CaptionPresetText } from '@/lib/editor/caption-preset-text';
import { CAPTION_PRESETS, captionPresetPatch, type CaptionPreset, type CaptionPresetId } from '@/lib/editor/caption-presets';
import { editorTextFont, textFontWeight } from '@/lib/editor/text-fonts';
import { TextFontStyles } from './text-font-styles';

/** A tile draws the 1080-wide caption at this fraction of its size, so every preset keeps its proportions. */
const TILE_SCALE = .2;
const SAMPLE = 'this pays you', SAMPLE_TIMINGS = [{ start: 0, end: .4 }, { start: .4, end: .8 }, { start: .8, end: 1.2 }];
/** The moment shown: "pays" is being spoken and has settled at its full pop, "you" is still to come. */
const SAMPLE_TIME = .75, FPS = 60;

/** One preset as a still: the same renderer as the video, frozen while the second word is spoken. */
function PresetSample({ preset }: { preset: CaptionPreset }) {
  const look = captionPresetPatch({ kind: 'caption', duration: 1.2 }, preset.id), resolution = 1080 * TILE_SCALE;
  const box = preset.box;
  return <span className="caption-preset-sample" style={box ? { background: box.color, padding: `${box.paddingY * TILE_SCALE}px ${box.paddingX * TILE_SCALE}px`, borderRadius: box.radius * TILE_SCALE } : undefined}>
    <CaptionPresetText captionPreset={look.captionPreset} preset="karaoke" text={SAMPLE} frame={Math.round(SAMPLE_TIME * FPS)} fps={FPS} durationInFrames={Math.round(1.2 * FPS)}
      color={look.color} fontSize={look.fontSize * TILE_SCALE} highlightColor={look.textTemplate.highlightColor!} textStyle={look.textStyle} textGradient={look.textGradient}
      fontFamily={editorTextFont(preset.font).family} fontWeight={textFontWeight(preset.font, preset.weight)} resolution={resolution} wordTimings={SAMPLE_TIMINGS}/>
  </span>;
}

/** The Effects tab's caption presets: a grid of the 11 looks, each a still of the real caption. Choosing one applies it
 *  to the selected captions, or to every caption when none is selected. The applied preset stays marked. */
export function CaptionPresetPicker({ value, disabled, onChoose }: { value?: CaptionPresetId; disabled: boolean; onChoose: (id: CaptionPresetId) => void }) {
  return <>
    <TextFontStyles/>
    <ToggleGroup type="single" spacing={0} className="caption-preset-grid" aria-labelledby="effect-caption-presets-label" disabled={disabled} value={value ?? ''}
      onValueChange={next => { const id = (next || value) as CaptionPresetId | undefined; if (id) onChoose(id); }}>
      {CAPTION_PRESETS.map(preset => <ToggleGroupItem key={preset.id} value={preset.id} className="caption-preset-tile" aria-label={`${preset.number} ${preset.name}`} title={preset.description}>
        <span className="caption-preset-stage"><PresetSample preset={preset}/></span>
        <span className="caption-preset-name"><span className="caption-preset-number">{preset.number}</span>{preset.name}</span>
      </ToggleGroupItem>)}
    </ToggleGroup>
  </>;
}
