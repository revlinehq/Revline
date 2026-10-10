import { useId } from "react";
import { clamp, mix, progress } from "../core/easing";
import { linesFor, RevealText } from "../components/typography";
import { Mark, type SceneContext } from "./shared";

/** Typing, lateral composition shift, camera punch-in, and cursor click share one frame clock. */
export function ComposerScene({ scene, frame, duration, W, H, portrait, colors, accent }: SceneContext) {
  const id = useId().replace(/:/g, "");
  const cw = portrait ? W - 84 : W * .67;
  const ch = portrait ? 275 : 222;
  const slide = progress(frame, duration * .2, duration * .27);
  const x = portrait ? 42 : mix((W - cw) / 2, 66, slide);
  const y = portrait ? H * .42 : H * .42;
  const sendX = x + cw - 49; const sendY = y + ch - 43;
  const zoomStart = duration * .64; const zoomEnd = duration * .82;
  const zoom = scene.design.camera.mode === "static" ? 0 : progress(frame, zoomStart, zoomEnd - zoomStart);
  const scale = mix(1, portrait ? 2.3 : 3.2, zoom * (.55 + scene.design.camera.strength * .7));
  // Camera pans into Send. Its final screen-space location is near the visual center.
  const cameraX = mix(0, W / 2 - sendX * scale, zoom);
  const cameraY = mix(0, H / 2 - sendY * scale, zoom);
  const prompt = scene.subtitle || "Create a cinematic product demo. Reveal the UI, zoom into the details, and end on the logo.";
  const typing = clamp((frame - duration * .12) / (duration * .46));
  const typed = prompt.slice(0, Math.floor(prompt.length * typing));
  const typedLines = linesFor(typed, portrait ? 21 : 24, cw - 58);
  const clickFrame = duration * .86;
  const click = progress(frame, clickFrame, 15, "ease-out");
  const cursorP = progress(frame, duration * .71, duration * .14);
  const cursorX = mix(x + cw * .48, sendX + 4, cursorP);
  const cursorY = mix(y + ch * .62, sendY + 5, cursorP);
  const entrance = progress(frame, 0, Math.min(35,duration * .17), "ease-out");
  return <g>
    <g opacity={1 - zoom}><RevealText text={scene.title} x={portrait ? 42 : 64} y={portrait ? 155 : 146} width={W - 128} size={portrait ? 66 : 76} frame={frame} color={colors.ink} reveal={scene.design.reveal} easing={scene.design.easing}/></g>
    <g transform={`translate(${cameraX} ${cameraY}) scale(${scale})`}>
      <g transform={`translate(${x} ${y + (1 - entrance) * 60})`} opacity={entrance}>
        <rect x="-9" y="-9" width={cw + 18} height={ch + 18} rx="23" fill="none" stroke={colors.line} opacity=".3"/>
        <rect width={cw} height={ch} rx="16" fill={colors.surface} stroke={colors.line}/>
        <Mark x={30} y={32} size={23} color={accent}/><text x="51" y="37" fontSize="12" fill={colors.muted} letterSpacing="1.3">AI COMPOSER</text>
        <defs><clipPath id={id}><rect x="25" y="61" width={cw - 50} height={ch - 118}/></clipPath></defs>
        <g clipPath={`url(#${id})`} fontSize={portrait ? 21 : 24} fill={colors.ink}>{typedLines.map((line,i) => <text key={i} x="28" y={85 + i * 34}>{line}{i === typedLines.length - 1 && typing < 1 && Math.floor(frame / 12) % 2 === 0 ? "│" : ""}</text>)}</g>
        <path d={`M24 ${ch - 76}H${cw - 24}`} stroke={colors.line}/><circle cx="37" cy={ch - 40} r="10" fill="none" stroke={colors.muted}/><path d={`M32 ${ch - 40}H42M37 ${ch - 45}V${ch - 35}`} stroke={colors.muted}/><text x="61" y={ch - 36} fontSize="11" fill={colors.muted}>{typing < 1 ? "Describe your video" : "Ready to compose"}</text>
        <g transform={`translate(${cw - 73} ${ch - 67}) scale(${1 - Math.sin(click * Math.PI) * .06})`}><rect width="48" height="48" rx="12" fill={accent}/><path d="M24 34V14M15 23L24 14L33 23" fill="none" stroke={colors.bg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></g>
      </g>
      {!portrait ? <g opacity={slide * (1 - zoom)} transform={`translate(${W * .79} ${y + 31})`}><text fill={colors.muted} fontSize="11" letterSpacing="2">YOUR DIRECTION</text>{["Reveal the UI", "Get closer", "Resolve on the logo"].map((label,i) => <g key={label} opacity={progress(frame, duration * (.23 + i * .07), 18)}><path d={`M0 ${42 + i * 45}H17`} stroke={colors.muted}/><text x="27" y={47 + i * 45} fill={colors.ink} fontSize="15">{label}</text></g>)}</g> : null}
      <g opacity={progress(frame, duration * .68, 10)} transform={`translate(${cursorX} ${cursorY})`}><path d="M0 0L5 26L11 17L20 17Z" fill={colors.ink} stroke={colors.bg} strokeWidth="1.7"/></g>
      {frame >= clickFrame ? <circle cx={sendX} cy={sendY} r={mix(10,45,click)} fill="none" stroke={accent} opacity={1 - click} strokeWidth="1.5"/> : null}
    </g>
    <g opacity={progress(frame, duration * .92, duration * .06)}><rect width={W} height={H} fill={colors.bg} opacity=".9"/><Mark x={W / 2} y={H / 2} size={45} color={accent} frame={frame}/><text x={W / 2} y={H / 2 + 65} textAnchor="middle" fill={colors.muted} fontSize="14" letterSpacing="1.5">COMPOSING YOUR FILM</text></g>
  </g>;
}
