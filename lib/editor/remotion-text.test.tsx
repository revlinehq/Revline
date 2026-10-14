import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RemotionText } from './remotion-text-component';
import { REMOTION_TEXT_PRESETS, VFX_TEXT_PRESETS, remotionTextProps, validateRemotionTextTemplate, type RemotionTextProps } from './remotion-text';
import { textTemplatePatch } from './text-effects';
import { textLookPatch } from './text-looks';
import type { Clip } from './types';

const clip = { kind: 'graphic', start: 5, duration: 4, text: 'Make your next idea', color: '#ffffff', fontSize: 80, textTemplate: { preset: 'word-reveal' as const, duration: 4, offset: 0 } };
const props = (frame: number): RemotionTextProps => ({ ...remotionTextProps(clip, 5, 30)!, frame });
const render = (input: RemotionTextProps) => renderToStaticMarkup(<RemotionText {...input}/>);

test.each(REMOTION_TEXT_PRESETS)('%s is deterministic across forward and backward frame seeks', preset => {
  const input = { ...props(8), preset };
  const expected = render(input);
  render({ ...input, frame: 100 }); render({ ...input, frame: 0 });
  expect(render(input)).toBe(expected);
  expect(expected).not.toContain('NaN');
  expect(render({ ...input, frame: -1 })).toContain('opacity:0');
  expect(render({ ...input, durationInFrames: 1, frame: 0 })).not.toContain('NaN');
});

test('word reveal and pop preserve text layout while exposing later words over time', () => {
  const initial = render(props(0));
  expect(initial).toContain('Make'); expect(initial).toContain('your'); expect(initial).toContain('opacity:0');
  const final = render(props(119));
  expect(final).not.toContain('opacity:0');
  expect(final).toContain('translateY(0em)');
  const pop = render({ ...props(4), preset: 'word-pop' });
  expect(pop).toContain('scale(');
  expect(pop).not.toBe(render({ ...props(30), preset: 'word-pop' }));
});

test('karaoke uses supplied colors and duration-based highlighting without inventing speech timestamps', () => {
  const first = render({ ...props(0), preset: 'karaoke', highlightColor: '#ffcc00' });
  const final = render({ ...props(119), preset: 'karaoke', highlightColor: '#ffcc00' });
  expect(first).toContain('#ffcc00'); expect(first).toContain('#ffffff');
  expect(final).not.toContain('gradient');
  expect(first).toContain('color:#ffcc00');
  expect(first).not.toBe(final);
});

test('source timing survives splits and left trims, with consistent preview/export scaling', () => {
  const before = remotionTextProps(clip, 7.4, 30)!;
  const split = remotionTextProps({ ...clip, start: 7, duration: 2, textTemplate: { ...clip.textTemplate, offset: 2 } }, 7.4, 30)!;
  expect(split).toEqual(before);
  expect(remotionTextProps(clip, 6, 30, 720)?.fontSize).toBeCloseTo(80 * 720 / 1080);
  expect(remotionTextProps(clip, 5 + 1 / 30, 30)?.frame).toBe(1);
  expect(remotionTextProps({ ...clip, textTemplate: undefined }, 5, 30)).toBeNull();
});

test('renders user content as escaped text and preserves whitespace', () => {
  const markup = render({ ...props(119), text: '<img src=x onerror=alert(1)>\nhello  world' });
  expect(markup).not.toContain('<img'); expect(markup).toContain('&lt;img');
  expect(markup).toContain('\n'); expect(markup).toContain('  ');
});

test('validates text-only templates, colors and finite animation timing', () => {
  expect(() => validateRemotionTextTemplate(clip)).not.toThrow();
  expect(() => validateRemotionTextTemplate({ ...clip, kind: 'video' })).toThrow('captions');
  for (const template of [{ preset: 'unknown' }, { ...clip.textTemplate, highlightColor: '#12345' }, { ...clip.textTemplate, highlightColor: 'url(https://example.com)' }, { ...clip.textTemplate, duration: 0 }, { ...clip.textTemplate, offset: Infinity }]) expect(() => validateRemotionTextTemplate({ ...clip, textTemplate: template as typeof clip.textTemplate })).toThrow();
});

test.each(VFX_TEXT_PRESETS)('%s has distinct entrance/hold/exit and preserves frozen timing across cuts',preset=>{
  const authored={...clip,...textTemplatePatch({...clip,kind:'graphic',id:'lyric',sourceStart:0},preset)};
  const opening=remotionTextProps(authored,5+4/30,30)!,hold=remotionTextProps(authored,6.5,30)!,exit=remotionTextProps(authored,8.9,30)!;
  expect(render(opening)).not.toBe(render(hold));expect(render(exit)).not.toBe(render(hold));
  expect(render(hold)).toContain('data-text-phase="hold"');expect(render(exit)).toContain('data-text-phase="exit"');
  const trimmed={...authored,start:7,duration:2,textTemplate:{...authored.textTemplate!,offset:2}};
  expect(render(remotionTextProps(trimmed,8.9,30)!)).toBe(render(exit));
  for(const durationInFrames of [1,2])expect(render({...hold,frame:0,durationInFrames})).not.toMatch(/opacity:0(?:;|")/);
});

test('new VFX palettes are editable and reselecting preserves custom words/colors/rotation',()=>{
  const original={...clip,kind:'graphic' as const,id:'lyric',sourceStart:0,transform:{x:.5,y:.5,scale:1,rotation:17,opacity:1}};
  const first: Clip={...original,...textLookPatch(original,'neon-echo')};
  expect(first.color).toBe('#B72CFF');expect(first.textTemplate?.highlightColor).toBe('#FF962E');
  const customized={...first,text:'My own lyric',color:'#00ffcc',textTemplate:{...first.textTemplate!,highlightColor:'#ff0044'}};
  const reselected={...customized,...textTemplatePatch(customized,'neon-echo')};
  expect(reselected).toMatchObject({text:'My own lyric',color:'#00ffcc',transform:original.transform,textTemplate:{highlightColor:'#ff0044'}});
  expect(remotionTextProps(reselected,6,30)).toMatchObject({color:'#00ffcc',highlightColor:'#ff0044',text:'My own lyric'});
});
