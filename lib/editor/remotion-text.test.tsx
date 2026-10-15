import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RemotionText } from './remotion-text-component';
import { EXPRESSIVE_TEXT_PRESETS, REMOTION_TEXT_PRESETS, VFX_TEXT_PRESETS, remotionTextProps, validateRemotionTextTemplate, type RemotionTextProps } from './remotion-text';
import { textTemplatePatch } from './text-effects';
import { textLookPatch } from './text-looks';
import type { Clip } from './types';

const clip = { kind: 'graphic', start: 5, duration: 4, text: 'Make your next idea', color: '#ffffff', fontSize: 80, textTemplate: { preset: 'word-reveal' as const, duration: 4, offset: 0 } };
const props = (frame: number): RemotionTextProps => ({ ...remotionTextProps(clip, 5, 30)!, frame });
const render = (input: RemotionTextProps) => renderToStaticMarkup(<RemotionText {...input}/>);

test.each(EXPRESSIVE_TEXT_PRESETS)('%s keeps the approved rendering frame-driven and customizable',preset=>{
  const base={...props(5),preset,strength:1,revealDuration:.65,stagger:.07,text:'Make every word count.'};
  const entrance=render(base);
  expect(render({...base,frame:90})).not.toEqual(entrance);
  render({...base,frame:150});render({...base,frame:0});
  expect(render(base)).toEqual(entrance);
  expect(render({...base,strength:.2})).not.toEqual(render({...base,strength:2}));
  expect(entrance).toContain(`data-remotion-text="${preset}"`);
  expect(entrance).toContain('aria-label="Make every word count."');
  expect(entrance).not.toMatch(/animation:|transition:|NaN|Infinity/);
  expect(render({...base,text:'<script>literal & safe</script>'})).not.toContain('<script>');
});

test('expressive optional controls validate and survive split timing and same-preset reselection',()=>{
  const original={...clip,kind:'graphic' as const,id:'expressive',sourceStart:0,textTemplate:{preset:'blur-focus' as const,duration:4,offset:.8,strength:1.4,revealDuration:1.2,stagger:.11}};
  const same={...original,...textTemplatePatch(original,'blur-focus')};
  expect(same.textTemplate).toMatchObject(original.textTemplate);
  expect(remotionTextProps(same,6,30)).toMatchObject({frame:54,strength:1.4,revealDuration:1.2,stagger:.11});
  const changed={...original,...textTemplatePatch(original,'character-scramble')};
  expect(changed.textTemplate).toMatchObject({strength:1.4,revealDuration:1.2,stagger:.11,offset:0});
  for(const patch of [{strength:0},{strength:Infinity},{revealDuration:.01},{stagger:.3}])expect(()=>validateRemotionTextTemplate({...original,textTemplate:{...original.textTemplate,...patch}})).toThrow();
});

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

test('speech-timed captions keep every word in place and highlight actual nonuniform word intervals',()=>{
  const wordTimings=[{start:0,end:.1},{start:.5,end:.9},{start:1.5,end:1.9},{start:3,end:3.8}];
  const input={...props(18),preset:'karaoke' as const,wordTimings,highlightColor:'#C4B5FD'};
  const wordStyle=(markup:string,i:number)=>markup.match(new RegExp(`data-word-index="${i}" style="([^"]+)"`))?.[1];
  const active=render(input);
  expect(wordStyle(active,1)).toContain('background-color:#C4B5FD');
  expect(wordStyle(active,0)).toContain('background-color:transparent');
  expect(wordStyle(active,2)).toContain('background-color:transparent');
  expect(active.match(/background-color:#C4B5FD/g)).toHaveLength(1);
  expect(wordStyle(render({...input,frame:30}),1)).toContain('background-color:transparent');
  expect(wordStyle(render({...input,frame:95}),3)).toContain('background-color:#C4B5FD');
  expect(wordStyle(render({...input,frame:0}),3)).toContain('padding:.035em .12em');
  expect(wordStyle(active,1)).toContain('padding:.035em .12em');
  expect(render(input)).toBe(active);
});

test('speech timings reject mismatched, reversed, overlapping and out-of-range word data',()=>{
  const words=[{start:0,end:.2},{start:.5,end:.8},{start:1,end:1.4},{start:3,end:3.8}];
  const timed={...clip,textTemplate:{preset:'karaoke' as const,wordTimings:words}};
  expect(()=>validateRemotionTextTemplate(timed)).not.toThrow();
  for(const wordTimings of [words.slice(1),[{start:-1,end:.2},...words.slice(1)],[words[0],{start:.1,end:.8},...words.slice(2)],[...words.slice(0,3),{start:3,end:5}]])expect(()=>validateRemotionTextTemplate({...timed,textTemplate:{...timed.textTemplate,wordTimings}})).toThrow('Speech timings');
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
