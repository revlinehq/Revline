// HyperFrames 0.8.144's Play/Pause alignment uses 1x source-time math and
// re-seeks pending/starved decoders. Its regular media synchronizer already
// honors playback rate and tolerates normal frame drift without re-seeking.
// Remove this patch after upgrading to a verified upstream fix.
export const HYPERFRAMES_PLAYBACK_COMPAT_VERSION = '0.8.144';
const original = 'let L=vt(y),I=c-S+L;if(I>=0)try{y.currentTime=I}catch{}';
const corrected = 'let L=vt(y),I=(c-S)*$e(y)+L;if(I>=0&&!y.seeking&&(y.tagName!=="VIDEO"||y.readyState>=3)&&Math.abs(y.currentTime-I)>.04*$e(y))try{y.currentTime=I}catch{}';
const audioClockCandidate = '!pe(S)||!S.isConnected||h(S)||fl(S)';
const audibleClockCandidate = '!pe(S)||!S.isConnected||h(S)||Number(S.dataset.volume??1)<=0||fl(S)';
const audioDrift = 'if(!J&&!V&&!G&&X&&ne>Yt){';
const scaledAudioDrift = 'if(!J&&!V&&!G&&X&&ne>Yt*Math.max(1,r.tagName==="AUDIO"&&e.playing?Math.abs(T):1)){';

export function patchHyperframesPlaybackRuntime(source, version) {
  if (version !== HYPERFRAMES_PLAYBACK_COMPAT_VERSION || source.split(original).length !== 2 || source.split(audioClockCandidate).length !== 2 || source.split(audioDrift).length !== 2) throw new Error('Review the HyperFrames playback compatibility patches for this runtime version.');
  // Play/Pause must not restart an unfinished video seek or seek a starved
  // decoder a few milliseconds ahead of its buffered frame. Match the runtime's
  // 40ms transport tolerance, scaled into source time for accelerated clips.
  // Explicit paused seek, render-seek and frame-step sync stay untouched.
  // A silent native audio element must not drive picture time. Its timestamps
  // can advance independently of video decoding, causing catch-up seeks and
  // buffering pauses despite an entirely silent timeline. Preserve audible
  // audio-master sync and fall back to the monotonic clock for silent projects.
  // Secondary audio must tolerate 40ms of timeline drift, including at 4x.
  // A fixed source-time threshold repeatedly seeks normal decoder jitter.
  // Large discontinuities and explicit forceSync seeks stay unchanged.
  return source.replace(original, corrected).replace(audioClockCandidate, audibleClockCandidate).replace(audioDrift, scaledAudioDrift);
}
