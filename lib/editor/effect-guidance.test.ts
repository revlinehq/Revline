import { expect,test } from 'vitest';
import { VISUAL_EFFECT_GUIDANCE } from './effect-guidance';
import { editorCapabilities } from '../ai/editor-capabilities';
test('retired footage Light sweep is absent from discovery while Light leak and Spotlight sweep remain',()=>{
  const catalog=editorCapabilities(),footage=catalog.effects.flatMap(group=>group.items);
  expect(footage.some(item=>'footageControl' in item&&String(item.footageControl)==='lightSweep')).toBe(false);
  expect('lightSweep' in VISUAL_EFFECT_GUIDANCE).toBe(false);
  expect(footage.some(item=>'footageControl' in item&&item.footageControl==='lightLeak')).toBe(true);
  expect(catalog.text.animations.some(item=>item.preset==='spotlight-sweep')).toBe(true);
});
