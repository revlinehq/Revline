// HyperFrames 0.8.144's Play/Pause alignment uses 1x source-time math even
// though its regular media synchronizer honors data-playback-rate. The two
// paths otherwise oscillate between different frames when resuming mid-clip.
// Remove this patch after upgrading to a verified upstream fix.
export const HYPERFRAMES_PLAYBACK_COMPAT_VERSION = '0.8.144';
const original = 'let L=vt(y),I=c-S+L;if(I>=0)try{y.currentTime=I}catch{}';
const corrected = 'let L=vt(y),I=(c-S)*$e(y)+L;if(I>=0&&Math.abs(y.currentTime-I)>.001)try{y.currentTime=I}catch{}';

export function patchHyperframesPlaybackRuntime(source, version) {
  if (version !== HYPERFRAMES_PLAYBACK_COMPAT_VERSION || source.split(original).length !== 2) throw new Error('Review the HyperFrames Play/Pause playback-rate compatibility patch for this runtime version.');
  // The 1ms no-op tolerance applies ONLY to Play/Pause alignment. Explicit
  // paused seek, render-seek and frame-step synchronization stay untouched.
  return source.replace(original, corrected);
}
