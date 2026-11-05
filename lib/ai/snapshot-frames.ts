type Frame = { time: number; image: string; width?: number; height?: number };
/** Polls carry a signed URL, so cached pixels stay out of reactively read rows. */
export async function snapshotFrames(state: { frames?: Frame[]; framesUrl?: string | null }): Promise<Frame[]> {
  if (state.frames) return state.frames;
  if (!state.framesUrl) throw new Error('The rendered frames are unavailable.');
  // Workers supports manual/follow only. Refuse 3xx through the status check below.
  const response = await fetch(state.framesUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('The rendered frames could not load. Retry this read.');
  return (await response.json() as { frames: Frame[] }).frames;
}
