import { Layer, entranceKeys } from "../components/layer";
import { fitText, linesFor, Paragraph, RevealText } from "../components/typography";
import { clamp, progress } from "../core/easing";
import { CameraRig } from "../components/camera";
import { SceneHeading, type SceneContext } from "./shared";
export function DataScene(ctx: SceneContext) {
  const { scene, frame, duration, W, H, portrait, colors, accent } = ctx;
  const pad = portrait ? 42 : 64; const width = W - pad * 2;
  const headingSize = fitText(scene.title,portrait ? 55 : 64,width,2);
  const headerHeight = linesFor(scene.title,headingSize,width).length * headingSize * 1.06;
  const paragraphHeight = linesFor(scene.subtitle,19,width).length * 28;
  const y = Math.max(portrait ? 340 : 250, 140 + headerHeight + paragraphHeight);
  const available = H - y - 55;
  const count = scene.items.length;
  return <g><SceneHeading {...ctx}/><CameraRig camera={scene.design.camera} frame={frame} duration={duration} width={W} height={H}>
    {scene.type === "chart" ? <g transform={`translate(${pad} ${y})`}>
      {[0,1,2,3].map(i => <g key={i}><path d={`M0 ${i * (available - 80) / 3}H${width}`} stroke={colors.line}/><text x="0" y={i * (available - 80) / 3 - 9} fontSize="10" fill={colors.muted}>{100 - Math.round(i * 100 / 3)}</text></g>)}
      {scene.items.map((item,i) => { const lane = width / count; const p = progress(frame,12 + i * scene.design.stagger * 30,Math.min(55,duration * .62),scene.design.easing); const bh = (available - 125) * item.value / 100 * clamp(p); const x = i * lane + lane * .16; return <g key={i}><rect x={x} y={available - 70 - bh} width={lane * .62} height={bh} rx="4" fill={accent} opacity={.45 + i * .16}/><text x={x + lane * .31} y={available - 88 - bh} textAnchor="middle" fontSize="35" fill={colors.ink} letterSpacing="-1">{Math.round(item.value * clamp(p))}%</text><Paragraph text={item.label} x={x + lane * .31} y={available - 38} width={lane * .9} size={Math.min(18,lane / 10)} color={colors.muted} center/></g>; })}
    </g> : scene.items.map((item,i) => {
      const row = portrait; const gap = scene.type === "workflow" ? 32 : 18;
      const cw = row ? width : (width - (count - 1) * gap) / count;
      const ch = row ? (available - (count - 1) * 16) / count : available;
      const x = row ? pad : pad + i * (cw + gap); const iy = y + (row ? i * (ch + 16) : 0);
      const delay = Math.min(.28,i * scene.design.stagger * 30 / duration);
      const end = Math.min(.8,delay + Math.min(34 / duration,.4));
      const labelSize = fitText(item.label,row ? 31 : 38,cw - (row ? 125 : 48),2);
      const labelY = row ? Math.max(43,ch * .42) : ch * .55;
      const labelHeight = linesFor(item.label,labelSize,cw - (row ? 125 : 48)).length * labelSize * 1.06;
      const detailY = labelY + labelHeight + 13;
      const detailSize = Math.min(17,Math.max(12,(ch - detailY - 15) / Math.max(1,linesFor(item.detail,17,cw - 48).length) / 1.45));
      return <Layer key={i} frame={frame} duration={duration} width={W} height={H} keyframes={entranceKeys(delay,end,.09,scene.design.easing)} motionBlur={scene.design.motionBlur}><g transform={`translate(${x} ${iy})`}>
        <rect width={cw} height={ch} rx="8" fill={colors.surface} stroke={colors.line}/>
        <text x={row ? cw - 47 : 26} y={row ? 38 : 44} fontSize="12" fill={colors.muted} letterSpacing="1.5">0{i + 1}</text>
        {!row ? <path d={`M26 68H${cw - 26}`} stroke={colors.line}/> : null}
        <RevealText text={item.label} x={26} y={labelY} width={cw - (row ? 125 : 48)} size={labelSize} frame={frame} delay={delay * duration + 7} duration={22} color={colors.ink} reveal="fade"/>
        <Paragraph text={item.detail} x={26} y={detailY} width={cw - 48} size={detailSize} color={colors.muted}/>
        {scene.type === "workflow" && i < count - 1 ? row ? <path d={`M${cw / 2} ${ch}V${ch + 16}`} stroke={accent} strokeDasharray="4 4"/> : <g transform={`translate(${cw + 8} ${ch / 2})`} stroke={accent} fill="none"><path d="M0 0H16M10 -5L16 0L10 5"/></g> : null}
      </g></Layer>;
    })}
  </CameraRig></g>;
}
