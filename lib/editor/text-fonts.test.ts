import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { TEXT_FONTS, textFontFaceCss, editorTextFont, textFont } from './text-fonts';
import { editorCapabilities } from '../ai/editor-capabilities';

test('every offered font has an actual bundled font file and local font-face source',()=>{
  expect(new Set(TEXT_FONTS.map(font=>font.id)).size).toBe(TEXT_FONTS.length);
  const css=textFontFaceCss();
  for(const font of TEXT_FONTS){
    const bytes=readFileSync(`public/fonts/${font.fileName}`);
    expect(bytes.subarray(0,4).toString('hex')).toBe(font.fileName.endsWith('.ttf')?'00010000':'774f4632');
    expect(css).toContain(`src:url('/fonts/${font.fileName}')`);
    expect(css).toContain(`font-weight:${font.faceWeight}`);
  }
  expect(css).not.toContain('https://');
});

test('new font licenses ship with attribution and AI exposes the same font choices',()=>{
  for(const font of TEXT_FONTS.slice(4))expect(readFileSync(`public/fonts/${font.label.replaceAll(' ','-')}-OFL.txt`,'utf8')).toContain('SIL OPEN FONT LICENSE');
  expect(editorCapabilities().text.fonts).toEqual(TEXT_FONTS.map(font=>({id:font.id,name:font.label})));
});

test('editor font faces cannot replace app families while composition faces retain their names',()=>{
  const editor=textFontFaceCss({}, 'editor'),composition=textFontFaceCss();
  for(const font of TEXT_FONTS){
    const alias=editorTextFont(font.id);
    expect(alias.fileName).toBe(font.fileName);
    expect(alias.weight).toBe(font.weight);
    expect(editor).toContain(`font-family:'${alias.family}'`);
    expect(editor).not.toContain(`font-family:'${font.family}'`);
    expect(composition).toContain(`font-family:'${textFont(font.id).family}'`);
  }
});
