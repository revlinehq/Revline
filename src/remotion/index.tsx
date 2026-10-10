import { Composition, registerRoot } from "remotion";
import { MotionComposition } from "./composition";
import { dimensions, durationFrames, FPS, initialProject } from "../lib/project";
function Root() {
  return <Composition id="MotionDemo" component={MotionComposition} durationInFrames={durationFrames(initialProject)} fps={FPS} width={1920} height={1080} defaultProps={{ project: initialProject, assets: [] }} calculateMetadata={({ props }) => ({ durationInFrames: durationFrames(props.project), ...dimensions(props.project.aspect) })}/>;
}
registerRoot(Root);
