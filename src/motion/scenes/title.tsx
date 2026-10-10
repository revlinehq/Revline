import { CameraRig } from "../components/camera";
import { fitText, linesFor, Paragraph, RevealText } from "../components/typography";
import { progress } from "../core/easing";
import { Mark, type SceneContext } from "./shared";
export function TitleScene(ctx: SceneContext) {
  const { scene, frame, duration, W, H, portrait, colors, accent, assets } = ctx;
  const centered = scene.design.layout === "centered" || scene.type === "logo";
  const pad = portrait ? 42 : 64;
  const width = W - pad * 2;
  const size = fitText(scene.title, portrait ? 100 : 142, width, portrait ? 4 : 3);
  const lines = linesFor(scene.title, size, width).length;
  const titleY = centered ? H * .5 : H * .43;
  const subtitleY = Math.min(H - 105, titleY + (lines - 1) * size * 1.06 + size * .55);
  const asset = assets.find(a => a.id === scene.assetId);
  return <CameraRig camera={scene.design.camera} frame={frame} duration={duration} width={W} height={H}>
    {scene.type === "logo" ? <g opacity={progress(frame, 0, 30)}>{asset ? <image href={asset.src} x={W / 2 - 60} y={H * .18} width="120" height="120" preserveAspectRatio="xMidYMid meet"/> : <Mark x={W / 2} y={H * .26} size={110} color={accent} frame={frame}/>}</g> : null}
    <RevealText text={scene.title} x={centered ? W / 2 : pad} y={titleY} width={width} size={size} frame={frame} delay={12} stagger={Math.max(2, scene.design.stagger * 30)} reveal={scene.design.reveal} easing={scene.motion === "spring" ? "spring" : scene.design.easing} duration={scene.motion === "snappy" ? 16 : 30} color={colors.ink} center={centered}/>
    <g opacity={progress(frame, 35, 24)} transform={`translate(0 ${(1 - progress(frame, 35, 24)) * 12})`}><Paragraph text={scene.subtitle} x={centered ? W / 2 : pad} y={subtitleY} width={width * .8} size={portrait ? 24 : 25} color={colors.muted} center={centered}/></g>
    {scene.type === "outro" ? <g opacity={progress(frame, 48, 25)}><Mark x={W / 2} y={H * .23} size={55} color={accent} frame={frame}/><path d={`M${W / 2 - 80} ${H - 105}H${W / 2 + 80}`} stroke={colors.line}/><text x={W / 2} y={H - 66} textAnchor="middle" fontSize="12" letterSpacing="3" fill={colors.muted}>MAKE SOMETHING MOVE</text></g> : <g opacity={progress(frame, 45, 25)}><path d={`M${pad} ${H - 79}H${W - pad}`} stroke={colors.line}/><text x={pad} y={H - 47} fontSize="12" fill={colors.muted}>A new way to show your work.</text><text x={W - pad} y={H - 47} fontSize="12" fill={colors.muted} textAnchor="end">01 — MOTION STUDY</text></g>}
  </CameraRig>;
}
