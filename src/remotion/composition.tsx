import React from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Asset, FPS, Project, Scene, sceneStart } from "../lib/project";

export type VideoProps = { project: Project; assets: Asset[] };
const palettes = {
  studio: { bg: "#151515", surface: "#222222", border: "#393939", ink: "#f2f2f2", muted: "#a0a0a0" },
  paper: { bg: "#f4f4f4", surface: "#ffffff", border: "#d5d5d5", ink: "#202020", muted: "#777777" },
  electric: { bg: "#050505", surface: "#161616", border: "#505050", ink: "#ffffff", muted: "#b0b0b0" },
};
type Palette = typeof palettes.studio;
function accentInk(accent: string) {
  const rgb = [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16));
  return rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 150 ? "#151515" : "#ffffff";
}
function wrap(text: string, length = 30): string[] {
  return text.split("\n").flatMap(paragraph => {
    const lines: string[] = []; let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if ((line + " " + word).trim().length > length && line) { lines.push(line); line = word; }
      else line = (line + " " + word).trim();
    }
    if (line) lines.push(line);
    return lines;
  });
}
function Multiline({ text, x, y, size, color, max = 30, center = false, weight = 600 }: { text: string; x: number; y: number; size: number; color: string; max?: number; center?: boolean; weight?: number }) {
  return <text x={x} y={y} fill={color} fontSize={size} fontWeight={weight} textAnchor={center ? "middle" : "start"} letterSpacing={size > 40 ? -size * .045 : 0}>{wrap(text, max).map((line, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : size * 1.12}>{line}</tspan>)}</text>;
}
function BrandMark({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  return <g transform={`translate(${x} ${y})`} fill="none" stroke={color} strokeWidth={size * .09}><ellipse rx={size * .45} ry={size * .17} transform="rotate(-40)"/><ellipse rx={size * .45} ry={size * .17} transform="rotate(40)"/><circle r={size * .1} fill={color} stroke="none"/></g>;
}
function Dashboard({ width, height, colors, accent, progress }: { width: number; height: number; colors: Palette; accent: string; progress: number }) {
  return <svg width={width} height={height} viewBox="0 0 1000 500">
    <rect width="1000" height="500" rx="12" fill={colors.surface}/>
    <path d="M190 0V500" stroke={colors.border}/><BrandMark x={36} y={35} size={28} color={accent}/><text x="62" y="42" fontSize="22" fill={colors.ink} fontWeight="650">orbit</text>
    {["Overview", "Projects", "Your team", "Insights"].map((t, i) => <g key={t} opacity={i ? .6 : 1}><rect x="14" y={86 + i * 52} width="163" height="40" rx="7" fill={i ? "transparent" : accent} fillOpacity=".12"/><rect x="30" y={100 + i * 52} width="13" height="13" rx="3" fill={i ? colors.muted : accent}/><text x="56" y={111 + i * 52} fill={colors.ink} fontSize="14">{t}</text></g>)}
    <text x="226" y="51" fill={colors.ink} fontSize="24" fontWeight="600">A little space to do big things.</text><text x="226" y="78" fill={colors.muted} fontSize="13">Welcome back. Let’s make today count.</text>
    <rect x="811" y="30" width="153" height="37" rx="7" fill={accent}/><text x="887" y="54" textAnchor="middle" fill={accentInk(accent)} fontSize="13" fontWeight="600">＋ New project</text>
    {[{ label: "Active projects", value: "12", line: "↑ 3 this week" }, { label: "Tasks completed", value: "84", line: "↑ 18% this month" }, { label: "Team momentum", value: "96%", line: "Looking good" }].map((card, i) => <g key={card.label} transform={`translate(${226 + i * 251} 112)`} opacity={interpolate(progress, [i * .12, .4 + i * .12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}><rect width="234" height="127" rx="10" fill={colors.bg} stroke={colors.border}/><text x="19" y="29" fill={colors.muted} fontSize="13">{card.label}</text><text x="19" y="75" fill={colors.ink} fontSize="36" fontWeight="600">{card.value}</text><text x="19" y="105" fill={accent} fontSize="12">{card.line}</text></g>)}
    <rect x="226" y="261" width="486" height="214" rx="10" fill={colors.bg} stroke={colors.border}/><text x="248" y="293" fill={colors.ink} fontSize="15" fontWeight="600">Your momentum</text><text x="627" y="293" fill={colors.muted} fontSize="11">Last 7 days</text>
    {[0, 1, 2].map(i => <line key={i} x1="248" y1={336 + i * 47} x2="690" y2={336 + i * 47} stroke={colors.border} strokeDasharray="4 6"/>)}
    <path d="M250 425 C295 425 295 380 340 392 S410 375 440 355 S510 390 550 345 S620 348 688 318" stroke={accent} strokeWidth="3" fill="none" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress}/>
    <rect x="734" y="261" width="244" height="214" rx="10" fill={colors.bg} stroke={colors.border}/><text x="754" y="293" fill={colors.ink} fontSize="15" fontWeight="600">Coming together</text>
    {["Website refresh", "Launch campaign", "The next big idea"].map((t, i) => <g key={t}><circle cx="760" cy={330 + i * 46} r="7" fill={accent} opacity={1 - i * .25}/><text x="779" y={335 + i * 46} fill={colors.ink} fontSize="12">{t}</text><rect x="778" y={344 + i * 46} width="148" height="4" rx="2" fill={colors.border}/><rect x="778" y={344 + i * 46} width={(138 - i * 35) * progress} height="4" rx="2" fill={accent}/></g>)}
  </svg>;
}
function BrowserFrame({ scene, asset, colors, accent, width, height, progress }: { scene: Scene; asset?: Asset; colors: Palette; accent: string; width: number; height: number; progress: number }) {
  return <g><rect width={width} height={height} rx="18" fill={colors.surface} stroke={colors.border} strokeWidth="2"/><path d={`M0 42 H${width}`} stroke={colors.border}/>{[0, 1, 2].map(i => <circle key={i} cx={22 + i * 17} cy="21" r="4" fill={colors.muted} opacity=".4"/>)}<rect x={width * .3} y="11" width={width * .4} height="20" rx="5" fill={colors.bg}/><text x={width / 2} y="25" fill={colors.muted} fontSize="10" textAnchor="middle">{asset ? asset.name.slice(0, 32) : "app.orbit.design"}</text>
    <svg x="12" y="54" width={width - 24} height={height - 66} viewBox={`0 0 ${width - 24} ${height - 66}`}>
      {asset ? <image href={asset.src} width={width - 24} height={height - 66} preserveAspectRatio="xMidYMid meet"/> : <Dashboard width={width - 24} height={height - 66} colors={colors} accent={accent} progress={progress}/>}
    </svg>
    {scene.type === "feature" ? <g transform={`translate(${width * (.32 + progress * .35)} ${height * (.78 - progress * .18)})`}><circle r={18 + Math.sin(progress * Math.PI) * 12} fill="none" stroke={accent} opacity=".5"/><path d="M0 0L4 29L11 20L22 21Z" fill={colors.ink} stroke={colors.bg} strokeWidth="2"/></g> : null}
  </g>;
}
function SceneVisual({ scene, project, assets }: { scene: Scene; project: Project; assets: Asset[] }) {
  const frame = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  const portrait = height > width; const square = height === width;
  const W = portrait ? 720 : square ? 960 : 1280; const H = portrait ? 1280 : square ? 960 : 720;
  const colors = palettes[project.theme]; const accent = project.theme === "paper" && project.accent === "#f2f2f2" ? "#303030" : project.accent;
  const duration = Math.round(scene.duration * fps);
  const entrance = scene.motion === "spring" ? spring({ frame, fps, config: { damping: 15, stiffness: 100 } }) : interpolate(frame, [0, scene.motion === "snappy" ? 10 : 24], [0, 1], { easing: t => 1 - Math.pow(1 - t, 3), extrapolateRight: "clamp" });
  const fade = interpolate(frame, [duration - 9, duration - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const progress = interpolate(frame, [10, Math.max(11, Math.min(duration - 10, 90))], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const asset = assets.find(a => a.id === scene.assetId);
  const pad = portrait ? 48 : 72; const large = portrait ? 67 : square ? 86 : 92;
  const lines = wrap(scene.title, portrait ? 16 : 25); const font = Math.min(large, H * .36 / Math.max(1, lines.length));
  const centerScene = ["title", "outro", "logo"].includes(scene.type);
  const headingLines = wrap(scene.title, portrait ? 19 : 38);
  const subtitleY = 131 + (headingLines.length - 1) * 53 + 43;
  const subtitleLines = wrap(scene.subtitle, portrait ? 43 : 85).length;
  const visualY = Math.max(portrait ? 360 : square ? 270 : 228, subtitleY + subtitleLines * 23 + 18);
  const visualHeight = H - visualY - (portrait ? 110 : 58);
  const titleY = scene.type === "logo" ? H * .58 : H * .41 - Math.max(0, lines.length - 2) * font * .8;
  return <AbsoluteFill style={{ backgroundColor: colors.bg }}><svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
    <rect width={W} height={H} fill={colors.bg}/>
    <g opacity={fade}>
      {centerScene ? <g opacity={Math.min(1, entrance)} transform={`translate(0 ${(1 - entrance) * 40})`}>
        {scene.type === "logo" ? <g transform={`translate(${W / 2} ${H * .3}) scale(${.6 + entrance * .4})`}>{asset ? <image href={asset.src} x="-85" y="-85" width="170" height="170" preserveAspectRatio="xMidYMid meet"/> : <BrandMark x={0} y={0} size={160} color={accent}/>}</g> : <g><rect x={W / 2 - 26} y={H * .16 - 26} width="52" height="52" rx="15" fill={accent} fillOpacity=".1"/><BrandMark x={W / 2} y={H * .16} size={35} color={accent}/></g>}
        <text x={W / 2} y={scene.type === "logo" ? H * .49 : H * .29} textAnchor="middle" fill={project.theme === "paper" ? colors.muted : accent} fontSize="13" fontWeight="600" letterSpacing="3">{scene.kicker}</text>
        <Multiline text={scene.title} x={W / 2} y={titleY} size={scene.type === "logo" ? font * .7 : font} color={colors.ink} center max={portrait ? 16 : 25}/>
        <Multiline text={scene.subtitle} x={W / 2} y={titleY + lines.length * (scene.type === "logo" ? font * .7 : font) * 1.12 + 26} size={portrait ? 22 : 24} color={colors.muted} center max={portrait ? 35 : 60} weight={400}/>
        {scene.type === "outro" ? <g transform={`translate(${W / 2 - 90} ${H - 130})`}><rect width="180" height="46" rx="23" fill={accent}/><text x="90" y="29" textAnchor="middle" fontSize="14" fontWeight="600" fill={accentInk(accent)}>Let’s get started ↗</text></g> : null}
      </g> : <>
        <g opacity={Math.min(1, entrance)} transform={`translate(0 ${(1 - entrance) * 26})`}><text x={pad} y="77" fill={project.theme === "paper" ? colors.muted : accent} fontSize="12" fontWeight="600" letterSpacing="3">{scene.kicker}</text><Multiline text={scene.title} x={pad} y={131} size={portrait ? 43 : 48} color={colors.ink} max={portrait ? 19 : 38}/><Multiline text={scene.subtitle} x={pad} y={subtitleY} size={19} color={colors.muted} max={portrait ? 43 : 85} weight={400}/></g>
        {["screenshot", "feature"].includes(scene.type) ? <g opacity={Math.min(1, entrance)} transform={`translate(${pad + (1 - entrance) * 25} ${visualY + (1 - entrance) * 55}) scale(${.96 + entrance * .04 + progress * .015})`}>
          <BrowserFrame scene={scene} asset={asset} colors={colors} accent={accent} width={W - pad * 2} height={visualHeight} progress={progress}/>
          {scene.type === "feature" ? <g transform={`translate(${portrait ? 18 : W - pad * 2 - 360} ${visualHeight - 105})`}><rect width={portrait ? 340 : 325} height="77" rx="13" fill={accent}/><text x="21" y="29" fill={accentInk(accent)} fontSize="16" fontWeight="600">{scene.items[0]?.label || "Made for your flow"}</text><text x="21" y="53" fill={accentInk(accent)} opacity=".75" fontSize="13">{(scene.items[0]?.detail || "A better way to work").slice(0, 43)}</text></g> : null}
        </g> : null}
        {scene.type === "cards" ? scene.items.map((item, i) => {
          const count = scene.items.length; const stacked = portrait; const cw = stacked ? W - pad * 2 : (W - pad * 2 - (count - 1) * 16) / Math.max(1, count); const ch = stacked ? Math.min(175, (visualHeight - (count - 1) * 15) / Math.max(1, count)) : visualHeight - 20;
          const p = spring({ frame: frame - i * Math.min(7, Math.floor(duration / 10)), fps, config: { damping: 24 } });
          return <g key={i} opacity={Math.min(1, p)} transform={`translate(${stacked ? pad : pad + i * (cw + 16)} ${visualY + (stacked ? i * (ch + 15) : 0) + (1 - p) * 60})`}><rect width={cw} height={ch} rx="18" fill={colors.surface} stroke={colors.border}/><rect x="24" y="26" width="45" height="45" rx="12" fill={accent} fillOpacity=".12"/><text x="47" y="55" textAnchor="middle" fill={project.theme === "paper" ? colors.ink : accent} fontSize="22">{["✦", "↗", "◎", "◇", "＋", "→"][i]}</text><Multiline text={item.label} x={24} y={stacked ? 105 : ch * .59} size={Math.min(30, cw / 8)} color={colors.ink} max={Math.max(10, Math.floor(cw / 17))}/><Multiline text={item.detail} x={24} y={stacked ? 136 : ch * .74} size={16} color={colors.muted} max={Math.max(10, Math.floor(cw / 10))} weight={400}/></g>;
        }) : null}
        {scene.type === "chart" ? <g transform={`translate(${pad} ${visualY})`}><rect width={W - pad * 2} height={visualHeight} rx="18" fill={colors.surface} stroke={colors.border}/>{[0, 1, 2, 3].map(i => <line key={i} x1="40" x2={W - pad * 2 - 30} y1={35 + i * (visualHeight - 110) / 3} y2={35 + i * (visualHeight - 110) / 3} stroke={colors.border} strokeDasharray="4 6"/>)}{scene.items.map((item, i) => {
          const gap = (W - pad * 2 - 80) / Math.max(1, scene.items.length); const barH = (visualHeight - 130) * item.value / 100 * progress; const x = 40 + gap * i + gap * .18;
          return <g key={i}><rect x={x} y={visualHeight - 65 - barH} width={gap * .64} height={barH} rx="7" fill={accent} opacity={.45 + i * .12}/><text x={x + gap * .32} y={visualHeight - 80 - barH} textAnchor="middle" fill={colors.ink} fontSize="28" fontWeight="600">{Math.round(item.value * progress)}%</text><Multiline text={item.label} x={x + gap * .32} y={visualHeight - 33} size={portrait ? 14 : 17} color={colors.muted} center max={12}/></g>;
        })}</g> : null}
        {scene.type === "workflow" ? scene.items.map((item, i) => {
          const count = scene.items.length; const vertical = portrait; const cw = vertical ? W - pad * 2 : (W - pad * 2 - (count - 1) * 36) / Math.max(1, count); const ch = vertical ? Math.min(155, (visualHeight - (count - 1) * 36) / Math.max(1, count)) : 210;
          const p = interpolate(frame - i * Math.min(12, Math.floor(duration / 12)), [0, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return <g key={i} opacity={p} transform={`translate(${vertical ? pad : pad + i * (cw + 36)} ${visualY + (vertical ? i * (ch + 36) : 50)})`}>{i < count - 1 ? vertical ? <path d={`M${cw / 2} ${ch}V${ch + 36}`} stroke={accent} strokeDasharray="5 4"/> : <path d={`M${cw} ${ch / 2}H${cw + 36}`} stroke={accent} strokeDasharray="5 4"/> : null}<rect width={cw} height={ch} rx="18" fill={colors.surface} stroke={colors.border}/><circle cx="35" cy="36" r="15" fill={accent}/><text x="35" y="41" fill={accentInk(accent)} fontSize="13" fontWeight="600" textAnchor="middle">{i + 1}</text><Multiline text={item.label} x={24} y={vertical ? 90 : 112} size={Math.min(27, cw / 9)} color={colors.ink} max={Math.max(10, Math.floor(cw / 16))}/><Multiline text={item.detail} x={24} y={vertical ? 122 : 153} size={16} color={colors.muted} max={Math.max(10, Math.floor(cw / 10))} weight={400}/></g>;
        }) : null}
      </>}
      <text x={W - pad} y={H - 22} fill={colors.muted} opacity=".55" fontSize="10" textAnchor="end" letterSpacing="2">{project.name.toUpperCase()}</text>
    </g>
  </svg></AbsoluteFill>;
}
export function MotionComposition({ project, assets }: VideoProps) {
  return <AbsoluteFill style={{ backgroundColor: palettes[project.theme].bg }}>{project.scenes.map((scene, index) => {
    const start = sceneStart(project, index); const duration = Math.round(scene.duration * FPS);
    return <Sequence key={scene.id} from={start} durationInFrames={duration} name={scene.title}><SceneVisual scene={scene} project={project} assets={assets}/></Sequence>;
  })}</AbsoluteFill>;
}
