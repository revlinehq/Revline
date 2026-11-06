---
name: "recipe-typing"
description: "Recipe for typing: text appearing letter by letter at keyboard or dictation speed, with the newest letters in a highlight color fading to ink. Read when the motion log says types, dictation, text streams in or cursor."
---
# Typing with a colored highlight

A good typing move keeps the layout still while letters arrive at a steady rate, with a short colored tail on the newest letters.

**Motion-log words:** types, typing, typed out, dictation, words stream in, text fills the box, cursor, the newest letters are colored, live transcription.

## Rules
- Lay the text out at its final size from the start (letters at opacity 0 keep their space), so lines never reflow while typing.
- **Measure it:** read the reference at fps 10 and count letters between frames for its cps.
- Word by word: split `type: 'words'` and step per word.
- **Highlight length:** the color hold (`.12` in the Example) times cps is how many letters stay colored. Match the reference (3 to 8 letters).
- **Deleting text:** the same in reverse, `tl.set(char, { opacity: 0 }, t)` from the last letter back.
- **A caret:** a thin bar whose x is `tl.set` to each letter's `offsetLeft + offsetWidth` (and y to its line) at that letter's time, measured where the timeline is built.

## Example
```ts
const cps = 28, color = '#8f7ae5', ink = '#1d1d1b';
const { chars } = new SplitText(el, { type: 'chars' });   // el holds the full text, laid out at its final size
gsap.set(chars, { opacity: 0, color });
chars.forEach((char, i) => {
  const t = at + i / cps;
  tl.set(char, { opacity: 1 }, t)                                          // appears on its keystroke
    .to(char, { color: ink, duration: .35, ease: 'power3.out' }, t + .12);  // the newest ~4 letters stay colored
});
```
