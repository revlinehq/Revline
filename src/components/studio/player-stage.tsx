"use client";
import { memo, useEffect, useMemo, type RefObject } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { MotionComposition } from "@/remotion/composition";
import { Asset, dimensions, durationFrames, FPS, Project } from "@/lib/project";
function Stage({ project, assets, playerRef, onFrame, onPlaying }: { project: Project; assets: Asset[]; playerRef: RefObject<PlayerRef | null>; onFrame: (frame: number) => void; onPlaying: (playing: boolean) => void }) {
  const inputProps = useMemo(() => ({ project, assets }), [project, assets]);
  const size = dimensions(project.aspect);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const frameListener = ({ detail }: { detail: { frame: number } }) => { if (detail.frame % 3 === 0) onFrame(detail.frame); };
    const play = () => onPlaying(true); const pause = () => onPlaying(false);
    onFrame(player.getCurrentFrame()); onPlaying(player.isPlaying());
    player.addEventListener("frameupdate", frameListener);
    player.addEventListener("play", play); player.addEventListener("pause", pause); player.addEventListener("ended", pause);
    return () => { player.removeEventListener("frameupdate", frameListener); player.removeEventListener("play", play); player.removeEventListener("pause", pause); player.removeEventListener("ended", pause); };
  }, [playerRef, onFrame, onPlaying, project.aspect]);
  return <Player ref={playerRef} component={MotionComposition} inputProps={inputProps} durationInFrames={durationFrames(project)} fps={FPS} compositionWidth={size.width} compositionHeight={size.height} initialFrame={Math.min(45,durationFrames(project) - 1)} controls={false} loop clickToPlay={false} style={{ width: "100%", aspectRatio: `${size.width}/${size.height}` }} errorFallback={({ error }) => <div className="p-8 text-sm text-red-300">Preview error: {error.message}</div>}/>;
}
export const PlayerStage = memo(Stage);
