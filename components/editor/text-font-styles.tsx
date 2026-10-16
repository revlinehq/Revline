import { textFontFaceCss } from '@/lib/editor/text-fonts';

/** One persistent, deduplicated parent stylesheet; composition faces remain iframe-local. */
export function TextFontStyles() { return <style href="revline-editor-text-fonts" precedence="default">{textFontFaceCss({}, 'editor')}</style>; }
