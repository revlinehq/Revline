import { test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RemotionText } from './remotion-text-component';
import { remotionTextProps } from './remotion-text';
import { DEFAULT_TEXT_APPEARANCE, resolvedTextAppearance, textAppearance, textStyle, validateTextStyle } from './text-style';
import { TEXT_FONTS, textFontFaceCss } from './text-fonts';
import type { Clip } from './types';

const text: Clip = { id:'title',kind:'graphic',track:1,start:0,duration:3,sourceStart:0,text:'My own words',color:'#00FFCC',fontFamily:'anton',textTemplate:{preset:'neon-echo'},textStyle:{...DEFAULT_TEXT_APPEARANCE,strokeWidth:6,strokeColor:'#FF0044',shadowX:3,shadowY:6,shadowBlur:12,shadowColor:'#112233',glowBlur:18,glowColor:'#AABBCC'} };

test('custom fonts and decoration scale together for output resolution',()=>{
  expect(textStyle(text,720)).toMatchObject({fontFamily:'Anton',fontWeight:400,fontSize:92*720/1080});
  expect(textAppearance(text,720)).toMatchObject({WebkitTextStroke:'4px #FF0044',textShadow:'2px 4px 8px #112233,0 0 12px #AABBCC'});
  const urls=Object.fromEntries(TEXT_FONTS.map(font=>[font.id,`./${font.fileName}`]));
  const css=textFontFaceCss(urls);
  for(const font of TEXT_FONTS)expect(css).toContain(`src:url('./${font.fileName}')`);
  expect(()=>textFontFaceCss({anton:'javascript:alert(1)'})).toThrow('Font URLs');
});

test('all animated text respects explicit color/stroke/shadow/glow without legacy appearance leakage',()=>{
  for(const preset of ['word-reveal','word-pop','neon-echo','lyric-slam','kinetic-stack'] as const){
    const props=remotionTextProps({...text,textTemplate:{preset}},1,30,720)!;
    const markup=renderToStaticMarkup(<RemotionText {...props}/>);
    expect(markup).toContain('color:#00FFCC');
    expect(markup).toContain('-webkit-text-stroke:4px #FF0044');
    expect(markup).toContain('font-family:Anton');
    expect(markup).not.toContain('gradient');
    expect(markup).not.toContain('data-text-accent="underline"');
    expect(markup).not.toContain('text-transform:uppercase');
  }
  const plain=renderToStaticMarkup(<RemotionText {...remotionTextProps({...text,textStyle:{...DEFAULT_TEXT_APPEARANCE}},1,30)!}/>);
  expect(plain).toContain('-webkit-text-stroke:0px #000000');
  expect(plain).not.toContain('0 0 .13em');
});

test('legacy appearance remains materializable and invalid styles cannot enter manual or AI edits',()=>{
  expect(resolvedTextAppearance({...text,textStyle:undefined})).toMatchObject({strokeWidth:92*.048,strokeColor:'#FF962E',glowColor:'#00FFCC'});
  expect(()=>validateTextStyle(text)).not.toThrow();
  for(const patch of [{strokeWidth:21},{shadowY:Infinity},{glowColor:'url(x)'}])expect(()=>validateTextStyle({...text,textStyle:{...text.textStyle!,...patch}})).toThrow();
  expect(()=>validateTextStyle({...text,kind:'video'})).toThrow('text');
  expect(()=>validateTextStyle({...text,fontFamily:'unknown' as Clip['fontFamily']})).toThrow('font');
});
