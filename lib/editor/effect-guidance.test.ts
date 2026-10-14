import { expect,test } from 'vitest';
import { EFFECT_PRESETS } from './clip-effects';
import { TEXT_ANIMATION_PRESETS } from './text-effects';
import { EFFECT_GUIDANCE,TEXT_ANIMATION_GUIDANCE } from './effect-guidance';
import { editorCapabilities } from '../ai/editor-capabilities';
test('every supported effect and text animation has purpose and emphasis guidance in the actual agent catalog',()=>{
  for(const preset of EFFECT_PRESETS){const guide=EFFECT_GUIDANCE[preset];expect(guide.purpose.length).toBeGreaterThan(10);expect(guide.anchor.length).toBeGreaterThan(10);expect(guide.typicalFramesAt30fps[1]).toBeGreaterThanOrEqual(guide.typicalFramesAt30fps[0]);}
  for(const preset of TEXT_ANIMATION_PRESETS){expect(TEXT_ANIMATION_GUIDANCE[preset].emphasizes.length).toBeGreaterThan(10);expect(editorCapabilities().text.animations.find(animation=>animation.preset===preset)?.guidance).toEqual(TEXT_ANIMATION_GUIDANCE[preset]);}
  expect(EFFECT_GUIDANCE.punch.strength).toContain('no amount control');
  expect(TEXT_ANIMATION_GUIDANCE.karaoke.avoid).toContain('does not detect');
});
