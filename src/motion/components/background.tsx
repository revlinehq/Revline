import type { SceneDesign } from "../schema";
import type { Asset } from "../../lib/project";
import type { Palette } from "../scenes/shared";
export function Background({ design, width: W, height: H, colors, frame, assets }: { design: SceneDesign; width: number; height: number; colors: Palette; frame: number; assets: Asset[] }) {
  const asset = assets.find(a => a.id === design.backgroundAssetId);
  return <g><rect width={W} height={H} fill={colors.bg}/>{asset ? <image href={asset.src} width={W} height={H} preserveAspectRatio="xMidYMid slice" opacity=".35"/> : null}
    {design.background === "grid" ? <g stroke={colors.line} opacity=".45">{Array.from({ length: Math.ceil(W / 100) }, (_, i) => <path key={i} d={`M${i * 100} 0V${H}`}/>)}{Array.from({ length: Math.ceil(H / 100) }, (_, i) => <path key={i} d={`M0 ${i * 100}H${W}`}/>)}</g> : null}
    {design.background === "orbit" ? <g transform={`translate(${W * .85} ${H * .15}) rotate(${-20 + frame * .025})`} stroke={colors.line} fill="none" opacity=".7">{[.5, .8, 1.1, 1.4].map(n => <ellipse key={n} rx={W * .36 * n} ry={H * .4 * n} strokeWidth="1"/>)}<path d={`M${-W} 0H${W}M0 ${-H}V${H}`} strokeDasharray="3 9" opacity=".4"/></g> : null}
  </g>;
}
