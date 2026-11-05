---
name: "recipe-typing"
description: "Typing: text appearing letter by letter at keyboard or dictation speed, with the newest letters in a highlight color fading to ink."
---
# Typing with a colored highlight

**Motion-log words:** types, typing, typed out, dictation, words stream in, text fills the box, cursor, the newest letters are colored, live transcription.

```tsx
function Typed({ text, at = 0, cps = 28, color = '#8f7ae5', ink = '#1d1d1b' }: { text: string; at?: number; cps?: number; color?: string; ink?: string }) {
  const ref = useTimeline<HTMLDivElement>((tl, el) => {
    const { chars } = new SplitText(el, { type: 'chars' });
    gsap.set(chars, { opacity: 0, color });
    chars.forEach((char, i) => {
      const t = at + i / cps;
      tl.set(char, { opacity: 1 }, t)                                // appears on its keystroke
        .to(char, { color: ink, duration: .35, ease: 'power1.out' }, t + .12);  // the newest ~4 letters stay colored
    });
  });
  return <div ref={ref}>{text}</div>;
}
```
- **Speed:** keyboard 12 to 20 chars/s, dictation and live transcription 25 to 40 chars/s, often word by word (split `type: 'words'` and step per word at 3 to 5 words/s). Read the reference at fps 10 and count letters between frames for its cps.
- **Highlight length:** the color hold (`.12` above) times cps is how many letters stay colored; match what the reference shows (3 to 8 letters).
- Deleting text: the same in reverse, `tl.set(char, { opacity: 0 }, t)` from the last char back, usually faster (40 to 60 chars/s).
- A caret: a thin bar element whose x you `tl.set` to each char's `offsetLeft + offsetWidth` (and y to its line) at the char's time, measured where the timeline is built.
- Lay the text out at its final size from the start (opacity 0 chars keep their space), so lines never reflow while typing.