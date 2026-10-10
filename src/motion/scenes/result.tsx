import { CameraRig } from "../components/camera";
import { Layer, entranceKeys } from "../components/layer";
import { Paragraph, RevealText } from "../components/typography";
import { progress } from "../core/easing";
import { Mark, type SceneContext } from "./shared";
import { ProductWindow } from "./product";
export function ResultScene({ scene, frame, duration, W, H, portrait, colors, accent, assets }: SceneContext) {
  const pad = portrait ? 42 : 64; const rw = W - pad * 2;
  const y = portrait ? 350 : 255; const rh = Math.min(H - y - 125, rw * .53);
  const asset = assets.find(a => a.id === scene.assetId);
  const end = Math.min(.42, 36 / duration);
  return <g><RevealText text={scene.title} x={pad} y={portrait ? 151 : 135} width={rw} size={portrait ? 69 : 82} frame={frame} delay={5} color={colors.ink} reveal={scene.design.reveal} easing={scene.design.easing}/><g opacity={progress(frame,20,22)}><Paragraph text={scene.subtitle} x={pad} y={portrait ? 270 : 185} width={rw} color={colors.muted}/></g>
    <CameraRig camera={scene.design.camera} frame={frame} duration={duration} width={W} height={H}><Layer frame={frame} duration={duration} width={W} height={H} keyframes={entranceKeys(.05,end,.12,scene.design.easing)} motionBlur={scene.design.motionBlur}><g transform={`translate(${pad} ${y})`}>
      <rect width={rw} height={rh} rx="12" fill={colors.surface} stroke={colors.line}/>
      {asset ? <ProductWindow width={rw} height={rh} colors={colors} accent={accent} frame={frame} image={asset.src}/> : <g><Mark x={rw * .12} y={rh * .24} size={34} color={accent} frame={frame}/><text x={rw * .07} y={rh * .56} fontSize={portrait ? 59 : 86} fontWeight="600" letterSpacing="-4" fill={colors.ink}>An idea. A film.</text><text x={rw * .075} y={rh * .72} fontSize="18" fill={colors.muted}>Motion starts with a sentence.</text></g>}
      <g transform={`translate(22 ${rh + 26})`} opacity={progress(frame,38,22)}><circle cx="5" cy="6" r="4" fill={accent}/><text x="20" y="11" fontSize="11" fill={colors.muted} letterSpacing="1.3">PREVIEW READY</text><text x={rw - 44} y="11" textAnchor="end" fontSize="11" fill={colors.muted}>MP4 / 1080P</text><path d={`M0 31H${rw - 44}`} stroke={colors.line}/><path d={`M0 31H${(rw - 44) * progress(frame, 38, Math.max(20,duration - 39), "linear")}`} stroke={accent} strokeWidth="2"/></g>
    </g></Layer></CameraRig>
  </g>;
}
