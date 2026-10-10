import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Asset, Project } from "../lib/project";
import { defaultDesign } from "./schema";
import { buildTimeline, transitionPose } from "./core/timeline";
import { transitionStyle } from "./components/layer";
import { Background } from "./components/background";
import { CustomLayers } from "./components/custom-layers";
import { palettes, ShotLabel } from "./scenes/shared";
import { TitleScene } from "./scenes/title";
import { ProductScene } from "./scenes/product";
import { ComposerScene } from "./scenes/composer";
import { ResultScene } from "./scenes/result";
import { DataScene } from "./scenes/data";

export type FilmProps = { project: Project; assets: Asset[] };
function Shot({ project, assets, index, timing, nextType }: FilmProps & { index: number; timing: ReturnType<typeof buildTimeline>[number]; nextType?: Project["scenes"][number]["design"]["transition"]["type"] }) {
  const localFrame = useCurrentFrame(); const { width, height } = useVideoConfig();
  const scene = project.scenes[index]; const frame = Math.min(localFrame,timing.duration - 1);
  const portrait = height > width; const W = portrait ? 720 : width === height ? 960 : 1280; const H = portrait ? 1280 : width === height ? 960 : 720;
  const colors = palettes[project.theme]; const accent = project.theme === "paper" && project.accent.toLowerCase() === "#f2f2f2" ? "#252525" : project.accent;
  const enter = transitionPose(scene.design.transition.type,localFrame,timing.enter,width,true);
  const exit = localFrame >= timing.duration && nextType ? transitionPose(nextType,localFrame - timing.duration,timing.exit,width,false) : { x: 0, scale: 1, opacity: 1, insetRight: 0 };
  const pose = { x: enter.x + exit.x, scale: enter.scale * exit.scale, opacity: enter.opacity * exit.opacity, insetRight: enter.insetRight };
  const context = { scene, project, assets, frame, duration: timing.duration, W, H, portrait, colors, accent };
  return <AbsoluteFill style={{ ...transitionStyle(pose), overflow: "hidden" }}><svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
    <Background design={scene.design} width={W} height={H} colors={colors} frame={frame} assets={assets}/>
    <ShotLabel {...context}/>
    {["title","logo","outro"].includes(scene.type) ? <TitleScene {...context}/> : scene.type === "composer" ? <ComposerScene {...context}/> : scene.type === "result" ? <ResultScene {...context}/> : ["screenshot","feature"].includes(scene.type) ? <ProductScene {...context}/> : <DataScene {...context}/>}
    <CustomLayers design={scene.design} frame={frame} duration={timing.duration} width={W} height={H} colors={colors} accent={accent} assets={assets}/>
  </svg></AbsoluteFill>;
}
export function Film({ project, assets }: FilmProps) {
  const { fps } = useVideoConfig();
  // Imported v1 projects and an editor kept open during an update still have useful defaults.
  const normalized = { ...project, scenes: project.scenes.map(s => ({ ...s, design: s.design || defaultDesign(s.type) })) };
  const timeline = buildTimeline(normalized.scenes,fps);
  return <AbsoluteFill style={{ backgroundColor: palettes[project.theme].bg }}>
    {normalized.scenes.map((scene,i) => <Sequence key={scene.id} from={timeline[i].start} durationInFrames={timeline[i].renderDuration} name={scene.title}><Shot project={normalized} assets={assets} index={i} timing={timeline[i]} nextType={normalized.scenes[i + 1]?.design.transition.type}/></Sequence>)}
    {project.soundtrack && project.soundtrack !== "silent" ? <Audio src={staticFile(`audio/${project.soundtrack}.wav`)} loop volume={.24}/> : null}
    {project.soundtrack && project.soundtrack !== "silent" ? timeline.slice(1).map((t,i) => <Sequence key={`sound-${i}`} from={t.start} durationInFrames={15}><Audio src={staticFile("audio/transition.wav")} volume={.17}/></Sequence>) : null}
    {project.soundtrack && project.soundtrack !== "silent" ? normalized.scenes.map((s,i) => s.type === "composer" ? <Sequence key={`click-${i}`} from={timeline[i].start + Math.round(timeline[i].duration * .86)} durationInFrames={6}><Audio src={staticFile("audio/click.wav")} volume={.35}/></Sequence> : null) : null}
  </AbsoluteFill>;
}
