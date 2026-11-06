---
name: "example"
description: "A complete scene module in the isometric line diagram style (stacked blocks, accent edge, dimension line, caption), plus how to draw charts, bars, counters and structures the same way."
---
# Example: a stacked isometric diagram

A complete scene module in the isometric line diagram style: a base block draws on, a second block drops onto it on support posts, labels wipe in, a dimension line and its note (class `caption`) finish it, then it holds. This is an example, not a preset: choose shapes, values and timing for the idea.

## Example

```ts
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
export default function scene({ root, tl, gsap }) {
  const ACCENT = '#76B900'; // the subject's brand color, or one muted hue
  root.innerHTML = `<div style="position:absolute;inset:0;font-family:Inter">
  <svg class="dia" width="528" height="330" viewBox="0 0 528 330" style="position:absolute;left:696px;top:640px;overflow:visible">
    <defs><pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 10L10 0" stroke="#555" stroke-width="1"/></pattern></defs>
    <g class="base">
      <path d="M20 230L382 230L508 170L146 170Z" fill="#181818" stroke="#BDBDBD" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M20 230V270H382V230" fill="url(#hatch)" stroke="#BDBDBD" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M382 230L508 170V210L382 270" fill="#151515" stroke="#BDBDBD" stroke-width="2.5" stroke-linejoin="round"/>
    </g>
    <path class="accent" d="M20 270H382" fill="none" stroke="${ACCENT}" stroke-width="3"/>
    <text class="baseLabel" x="201" y="258" text-anchor="middle" fill="#F5F5F5" font-size="27" font-weight="500">GeForce</text>
    <path class="posts" d="M110 160V230M350 160V230M450 112V196" fill="none" stroke="#777" stroke-width="2"/>
    <g class="deck">
      <path d="M110 120H350L450 72H210Z" fill="#202020" stroke="#D6D6D6" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M110 120V160H350V120M350 160L450 112V72" fill="#111" stroke="#D6D6D6" stroke-width="2.5" stroke-linejoin="round"/>
      <text x="230" y="149" text-anchor="middle" fill="#F5F5F5" font-size="25" font-weight="500">CUDA</text>
    </g>
    <path class="dim" d="M20 290H382M20 283V297M382 283V297" fill="none" stroke="#888" stroke-width="1.5"/>
    <text class="caption" x="201" y="320" text-anchor="middle" fill="#A6A6A6" font-size="20">GeForce carries CUDA.</text>
  </svg></div>`;
  const q = (s: string) => root.querySelector(s);
  const draw = (t, at, d = .7) => tl.fromTo(t, { drawSVG: '0%' }, { drawSVG: '100%', duration: d, ease: 'power3.inOut' }, at);
  const wipe = (t, at, d = .65) => tl.fromTo(t, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: d, ease: 'power3.inOut' }, at);
  // Times come from the transcript: each piece lands on its word.
  wipe(q('.base'), .2, .85);
  draw(q('.accent'), .2, .95);
  draw(q('.posts'), .5, .8);
  tl.fromTo(q('.deck'), { clipPath: 'inset(100% 0% 0% 0%)', y: -38 }, { clipPath: 'inset(0% 0% 0% 0%)', y: 0, duration: .8, ease: 'power3.out' }, .9);
  wipe(q('.baseLabel'), 1.5, .55);
  draw(q('.dim'), 1.8, 1.2);
  wipe(q('.caption'), 2.2, .8);
  // Hold the completed relationship so it can be read.
}
```

## Other shapes in the same style
| Shape | How |
| --- | --- |
| Line chart | axes `M56 12V212` and `M56 212H500` (#777, 1.5), no grid lines; the value as a 3 px round-capped path drawn with drawSVG while a white dot (r 5) follows it with MotionPathPlugin (`motionPath:{path, align: path, alignOrigin:[.5,.5]}`); the end value in Geist Mono |
| Comparison bars | outlined rects filled with the hatch pattern, revealed with the left-to-right wipe and staggered .12 to .14 s; one accent bracket measures the biggest |
| Counter | a Geist Mono number tweened on an object with onUpdate, power3.out, landing on the spoken value |
| Structure / house | uprights and roof lines as separate paths drawn on in order (front edges #F5F5F5, back edges #888), so the drawing builds like a sketch |