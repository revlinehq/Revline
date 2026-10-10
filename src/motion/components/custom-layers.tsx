import type { Asset } from "../../lib/project";
import type { SceneDesign } from "../schema";
import type { Palette } from "../scenes/shared";
import { Layer } from "./layer";
import { Paragraph } from "./typography";
export function CustomLayers({ design, frame, duration, width, height, colors, accent, assets }: { design: SceneDesign; frame: number; duration: number; width: number; height: number; colors: Palette; accent: string; assets: Asset[] }) {
  return <g>{design.layers.map(layer => {
    const color = layer.color === "accent" ? accent : layer.color.startsWith("#") ? layer.color : colors[layer.color as "ink"|"muted"|"surface"];
    const w = layer.width * width; const h = layer.height * height;
    const asset = assets.find(a => a.id === layer.assetId);
    return <Layer key={layer.id} frame={frame} duration={duration} keyframes={layer.keyframes} width={width} height={height} origin={[w / 2,h / 2]} motionBlur={design.motionBlur}>
      {layer.type === "text" ? <Paragraph text={layer.text} x={layer.align === "center" ? w / 2 : 0} y={layer.fontSize * height} width={w} size={layer.fontSize * height} color={color} center={layer.align === "center"}/> : layer.type === "rect" ? <rect width={w} height={h} rx="8" fill={color}/> : layer.type === "ellipse" ? <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={color}/> : asset ? <image href={asset.src} width={w} height={h} preserveAspectRatio="xMidYMid meet"/> : null}
    </Layer>;
  })}</g>;
}
