// HyperFrames 0.8.144's Play/Pause alignment uses 1x source-time math and
// re-seeks pending/starved decoders. Its regular media synchronizer already
// honors playback rate and tolerates normal frame drift without re-seeking.
// Remove this patch after upgrading to a verified upstream fix.
export const HYPERFRAMES_PLAYBACK_COMPAT_VERSION = '0.8.144';
const original = 'let L=vt(y),I=c-S+L;if(I>=0)try{y.currentTime=I}catch{}';
const corrected = 'let L=vt(y),I=(c-S)*$e(y)+L;if(I>=0&&!y.seeking&&(y.tagName!=="VIDEO"||y.readyState>=3)&&Math.abs(y.currentTime-I)>.04*$e(y))try{y.currentTime=I}catch{}';

export function patchHyperframesPlaybackRuntime(source, version) {
  if (version !== HYPERFRAMES_PLAYBACK_COMPAT_VERSION || source.split(original).length !== 2) throw new Error('Review the HyperFrames Play/Pause playback-rate compatibility patch for this runtime version.');
  // Play/Pause must not restart an unfinished video seek or seek a starved
  // decoder a few milliseconds ahead of its buffered frame. Match the runtime's
  // 40ms transport tolerance, scaled into source time for accelerated clips.
  // Explicit paused seek, render-seek and frame-step sync stay untouched.
  return source.replace(original, corrected);
}
