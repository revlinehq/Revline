import { textFontFaceCss } from '@/lib/editor/text-fonts';

/** Library cards and editing controls use the exact bundled fonts used by the composition. */
export function TextFontStyles() { return <style>{textFontFaceCss()}</style>; }
