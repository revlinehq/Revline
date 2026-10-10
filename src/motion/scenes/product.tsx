import { useId } from "react";
import { CameraRig } from "../components/camera";
import { Layer, entranceKeys } from "../components/layer";
import { progress } from "../core/easing";
import { Mark, type Palette, SceneHeading, type SceneContext } from "./shared";
export function ProductWindow({ width, height, colors, accent, frame, image }: { width: number; height: number; colors: Palette; accent: string; frame: number; image?: string }) {
  const id = useId().replace(/:/g, "");
  return <g><rect width={width} height={height} rx="18" fill={colors.surface} stroke={colors.line}/><path d={`M0 36H${width}`} stroke={colors.line}/>{[0,1,2].map(i => <circle key={i} cx={20 + i * 14} cy="18" r="3" fill={colors.muted} opacity=".5"/>)}<text x={width / 2} y="22" textAnchor="middle" fill={colors.muted} fontSize="10">{image ? "YOUR PRODUCT" : "FRAME / MOTION STUDIO"}</text>
    <defs><clipPath id={id}><rect x="10" y="46" width={width - 20} height={height - 56} rx="8"/></clipPath></defs>
    <g clipPath={`url(#${id})`}>{image ? <image href={image} x="10" y="46" width={width - 20} height={height - 56} preserveAspectRatio="xMidYMid meet"/> : <svg x="10" y="46" width={width - 20} height={height - 56} viewBox="0 0 1000 560">
      <rect width="1000" height="560" fill={colors.bg}/><path d="M210 0V560M210 68H1000" stroke={colors.line}/><Mark x={31} y={35} size={28} color={accent}/><text x="58" y="42" fontSize="22" fontWeight="600" fill={colors.ink}>frame</text>
      <text x="24" y="110" fill={colors.muted} fontSize="11" letterSpacing="1.8">DIRECTOR</text>
      <text x="24" y="149" fill={colors.ink} fontSize="17">What are we making?</text>
      <text x="24" y="177" fill={colors.muted} fontSize="11">A launch film, in a sentence.</text>
      <rect x="18" y="204" width="172" height="68" rx="7" fill={colors.raised}/><text x="30" y="229" fontSize="11" fill={colors.ink}>Show the idea. Reveal the UI.</text><text x="30" y="250" fontSize="11" fill={colors.muted}>Make every detail count.</text>
      <rect x="18" y="420" width="172" height="116" rx="8" stroke={colors.line} fill={colors.surface}/><text x="29" y="445" fontSize="11" fill={colors.muted}>Describe your next demo...</text><rect x="153" y="494" width="25" height="25" rx="6" fill={accent}/><path d="M165 513V502M160 507L165 502L170 507" fill="none" stroke={colors.bg} strokeWidth="1.5"/>
      <text x="234" y="39" fontSize="12" fill={colors.muted}>Introducing Frame</text><rect x="867" y="20" width="111" height="29" rx="5" fill={accent}/><text x="923" y="39" textAnchor="middle" fill={colors.bg} fontSize="11">Export video</text>
      <rect x="250" y="92" width="709" height="347" rx="4" fill={colors.surface}/><path d="M265 422H944" stroke={colors.line}/>
      <g opacity={progress(frame, 8, 40)} transform={`translate(0 ${(1 - progress(frame, 8, 40)) * 28})`}><text x="291" y="165" fontSize="9" fill={colors.muted} letterSpacing="2">FROM A SENTENCE TO A FILM</text><text x="290" y="254" fontSize="78" fontWeight="600" letterSpacing="-4" fill={colors.ink}>An idea. A film.</text><text x="294" y="303" fontSize="18" fill={colors.muted}>Motion starts with a sentence.</text></g>
      <text x="251" y="471" fontSize="10" fill={colors.muted}>STORYBOARD</text>{[0,1,2,3,4].map(i => <g key={i} transform={`translate(${251 + i * 143} 485)`}><rect width="129" height="59" rx="3" fill={colors.surface} stroke={i === 1 ? accent : colors.line}/><text x="10" y="16" fill={colors.muted} fontSize="8">0{i + 1}</text><path d="M20 32H100M35 42H85" stroke={colors.muted} opacity=".4"/></g>)}
    </svg>}</g></g>;
}
export function ProductScene(ctx: SceneContext) {
  const { scene, frame, duration, W, H, portrait, colors, accent, assets } = ctx;
  const full = scene.design.layout === "full-bleed";
  const pad = portrait ? 42 : full ? 28 : 64;
  const y = full ? H * .18 : portrait ? 340 : 260;
  const width = W - pad * 2;
  const height = H - y - (full ? 35 : 65);
  const asset = assets.find(a => a.id === scene.assetId);
  const entranceEnd = Math.min(.38, 36 / duration);
  const keys = entranceKeys(0, entranceEnd, .09, scene.design.easing);
  return <g>{full ? <text x="64" y="112" fontSize="28" fill={colors.ink}>{scene.title.replace(/\n/g," ")}</text> : <SceneHeading {...ctx}/>}
    <CameraRig camera={scene.design.camera} frame={frame} duration={duration} width={W} height={H}><Layer frame={frame} duration={duration} keyframes={keys} width={W} height={H} motionBlur={scene.design.motionBlur}><g transform={`translate(${pad} ${y})`}><ProductWindow width={width} height={height} colors={colors} accent={accent} frame={frame} image={asset?.src}/>
      {scene.type === "feature" ? <g><g transform={`translate(${width * (.43 + progress(frame, duration * .25, duration * .25) * .32)} ${height * .7})`}><circle r={10 + progress(frame, duration * .6, 20) * 18} fill="none" stroke={accent} opacity={1 - progress(frame, duration * .6, 20)}/><path d="M0 0L5 26L11 17L20 17Z" fill={colors.ink} stroke={colors.bg} strokeWidth="2"/></g><g opacity={progress(frame, duration * .45, 24)} transform={`translate(${width * .5} ${height * .68})`}><rect width={Math.min(360,width * .48)} height="75" rx="10" fill={colors.raised} stroke={colors.line}/><text x="18" y="29" fill={colors.ink} fontSize="17" fontWeight="600">{(scene.items[0]?.label || "Your feature").slice(0,30)}</text><text x="18" y="52" fill={colors.muted} fontSize="13">{(scene.items[0]?.detail || "A detail worth a closer look").slice(0,38)}</text></g></g> : null}
    </g></Layer></CameraRig>
  </g>;
}
