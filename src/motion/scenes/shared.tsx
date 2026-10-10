import type { Asset, Project, Scene } from "../../lib/project";
import { fitText, linesFor, Paragraph, RevealText } from "../components/typography";
import { progress } from "../core/easing";
export const palettes = {
  studio: { bg: "#101010", surface: "#191919", raised: "#222222", line: "#303030", ink: "#f4f4f4", muted: "#979797" },
  paper: { bg: "#f3f3f3", surface: "#ffffff", raised: "#e8e8e8", line: "#d2d2d2", ink: "#181818", muted: "#777777" },
  electric: { bg: "#000000", surface: "#121212", raised: "#232323", line: "#444444", ink: "#ffffff", muted: "#aaaaaa" },
};
export type Palette = typeof palettes.studio;
export type SceneContext = { scene: Scene; project: Project; assets: Asset[]; frame: number; duration: number; W: number; H: number; portrait: boolean; colors: Palette; accent: string };
export function inkOn(color: string) { const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)); return rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 150 ? "#161616" : "#ffffff"; }
export function Mark({ x, y, size, color, frame = 60 }: { x: number; y: number; size: number; color: string; frame?: number }) {
  const p = progress(frame, 0, 35);
  return <g transform={`translate(${x} ${y})`} fill="none" stroke={color} strokeWidth={size * .035}><rect x={-size * .4} y={-size * .4} width={size * .63} height={size * .63} rx={size * .1}/><rect x={-size * .23 + (1 - p) * size * .2} y={-size * .23 + (1 - p) * size * .2} width={size * .63} height={size * .63} rx={size * .1}/></g>;
}
export function ShotLabel({ scene, frame, W, colors, portrait }: Pick<SceneContext,"scene"|"frame"|"W"|"colors"|"portrait">) {
  return <g opacity={progress(frame, 4, 16, "ease-out")}><text x={portrait ? 42 : 64} y="59" fontSize="12" letterSpacing="2.2" fill={colors.muted}>{scene.kicker}</text><text x={W - (portrait ? 42 : 64)} y="59" textAnchor="end" fontSize="12" fill={colors.muted}>FRAME</text></g>;
}
export function SceneHeading({ scene, frame, W, colors, portrait }: SceneContext) {
  const pad = portrait ? 42 : 64;
  const font = fitText(scene.title, portrait ? 55 : 64, W - pad * 2, 2);
  const height = linesFor(scene.title, font, W - pad * 2).length * font * 1.06;
  return <g><RevealText text={scene.title} x={pad} y={120} width={W - pad * 2} size={font} frame={frame} color={colors.ink} reveal={scene.design.reveal} easing={scene.design.easing} stagger={scene.design.stagger * 30}/><g opacity={progress(frame, 20, 20)}><Paragraph text={scene.subtitle} x={pad} y={120 + height + 8} width={W - pad * 2} size={19} color={colors.muted}/></g></g>;
}
