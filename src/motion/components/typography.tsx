import { useId } from "react";
import { clamp, progress } from "../core/easing";
import type { Ease } from "../core/easing";
import type { SceneDesign } from "../schema";

// Deterministic font metrics approximation keeps preview and headless renders identical.
export function textWidth(text: string, size: number) {
  return [...text].reduce((width, char) => width + (/[ilI.,'!:;| ]/.test(char) ? .25 : /[MW@%]/.test(char) ? .87 : /[A-Z]/.test(char) ? .65 : .51) * size, 0);
}
export function linesFor(text: string, size: number, width: number) {
  return text.split("\n").flatMap(paragraph => {
    const lines: string[] = []; let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (textWidth(`${line} ${word}`.trim(), size) > width && line) { lines.push(line); line = word; }
      else line = `${line} ${word}`.trim();
    }
    return [...lines, line];
  });
}
export function fitText(text: string, size: number, width: number, maxLines: number) {
  let fitted = size;
  while (fitted > 18 && (linesFor(text, fitted, width).length > maxLines || linesFor(text, fitted, width).some(line => textWidth(line, fitted) > width))) fitted *= .94;
  return fitted;
}
export function RevealText({ text, x, y, width, size, frame, delay = 8, stagger = 3, reveal = "lines", easing = "cinematic", color, center = false, weight = 600, duration = 27 }: {
  text: string; x: number; y: number; width: number; size: number; frame: number; delay?: number; stagger?: number;
  reveal?: SceneDesign["reveal"]; easing?: Ease; color: string; center?: boolean; weight?: number; duration?: number;
}) {
  const id = useId().replace(/:/g, ""); const lines = linesFor(text, size, width); const lineHeight = size * 1.06;
  const fade = progress(frame, delay, duration, "ease-out");
  let wordIndex = 0;
  return <g fill={color} fontSize={size} fontWeight={weight} letterSpacing={size > 40 ? -size * .05 : 0} opacity={reveal === "fade" ? fade : 1}>
    {lines.map((line, i) => {
      const left = center ? x - textWidth(line, size) / 2 : x;
      const baseline = y + i * lineHeight;
      const p = progress(frame, delay + i * stagger, duration, easing);
      const clipId = `${id}-${i}`;
      if (reveal === "words") {
        const words = line.split(" ");
        return <g key={i}>{words.map((word, index) => {
          const start = left + textWidth(words.slice(0, index).join(" ") + (index ? " " : ""), size);
          const wp = progress(frame, delay + wordIndex++ * stagger, duration, easing);
          return <text key={index} x={start} y={baseline + (1 - wp) * size * .4} opacity={clamp(wp)}>{word}</text>;
        })}</g>;
      }
      return <g key={i}><defs><clipPath id={clipId}><rect x={left - size * .1} y={baseline - size * 1.01} width={width + size * .2} height={size * 1.17}/></clipPath></defs><g clipPath={reveal === "lines" ? `url(#${clipId})` : undefined}><text x={left} y={baseline} transform={reveal === "lines" ? `translate(0 ${(1 - p) * size * 1.15})` : undefined}>{line}</text></g></g>;
    })}
  </g>;
}
export function Paragraph({ text, x, y, width, size = 22, color, center = false }: { text: string; x: number; y: number; width: number; size?: number; color: string; center?: boolean }) {
  return <text x={x} y={y} fontSize={size} fill={color} fontWeight="400" textAnchor={center ? "middle" : "start"}>{linesFor(text, size, width).map((line, i) => <tspan x={x} key={i} dy={i ? size * 1.45 : 0}>{line}</tspan>)}</text>;
}
