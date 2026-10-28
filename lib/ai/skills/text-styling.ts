import { editorCapabilities } from '../editor-capabilities';
import type { EditorSkill } from './index';

// Built on read: the catalog module imports the skill index, so this must not run at import time.
export const textStyling: EditorSkill = {
  name: 'text-styling',
  description: 'Text and captions: fonts, looks, animations, templates, gradients, stroke/shadow/glow, placement and caption styling, with every control and its limits. Read before adding, styling or animating any text, title or caption.',
  get body() {
    const { text, captions } = editorCapabilities();
    return `# Text styling

Use applyTextLook for an explicitly requested editable look, setTextAnimation for a separate animation selection, styleTextClip/styleCaptions for font/size/solid colors/position/rotation/blend, and setTextStyle for stroke/shadow/glow. Word Reveal/Pop-in/etc are animations, not styled presets. Every text style preserves existing animation, custom motion, effect color, strength, timing, stagger and word timings. Default text resets appearance only; the Neon Echo look provides editable appearance without adding or replacing motion. Change animation independently with setTextAnimation only when requested.

Captions sit inside the platform's safe area: keep them clear of the bottom 20% on vertical video (app buttons and the description cover it) and away from faces. One look per video; a different look only marks a different kind of text (a title vs captions vs a callout).

## Catalog

Every font, look, animation, template and text control, with guidance:

\`\`\`json
${JSON.stringify({ text, captions })}
\`\`\`
`;
  },
};
