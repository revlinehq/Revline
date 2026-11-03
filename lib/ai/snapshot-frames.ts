type Frame = { time: number; image: string };
/** Polls carry a signed URL, so cached pixels stay out of reactively read rows. */
export async function snapshotFrames(state: { frames?: Frame[]; framesUrl?: string | null }): Promise<Frame[]> {
  if (state.frames) return state.frames;
  if (!state.framesUrl) throw new Error('The rendered frames are unavailable.');
  const response = await fetch(state.framesUrl, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('The rendered frames could not load. Retry this read.');
  return (await response.json() as { frames: Frame[] }).frames;
}
