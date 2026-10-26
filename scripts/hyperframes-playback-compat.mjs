// HyperFrames 0.8.144's Play/Pause alignment uses 1x source-time math and
// re-seeks pending/starved decoders. Its regular media synchronizer also
// repeatedly hard-seeks playing secondary audio for ordinary clock drift.
// Remove this patch after upgrading to a verified upstream fix.
export const HYPERFRAMES_PLAYBACK_COMPAT_VERSION = '0.8.144';
const original = 'let L=vt(y),I=c-S+L;if(I>=0)try{y.currentTime=I}catch{}';
const corrected = 'let L=vt(y),I=(c-S)*$e(y)+L;if(I>=0&&!y.seeking&&(y.tagName!=="VIDEO"||y.readyState>=3)&&Math.abs(y.currentTime-I)>.04*$e(y))try{y.currentTime=I}catch{}';
const audioClockCandidate = '!pe(S)||!S.isConnected||h(S)||fl(S)';
const audibleClockCandidate = '!pe(S)||!S.isConnected||h(S)||Number(S.dataset.volume??1)<=0||fl(S)';
const audioDrift = 'if(!J&&!V&&!G&&X&&ne>Yt){';
const scaledAudioDrift = 'if(!J&&!V&&!G&&X&&ne>Yt*(r.tagName==="AUDIO"&&e.playing?Math.abs(T):1)){';
const playingVideo = 'J=r.tagName==="VIDEO"&&!r.paused&&e.playing';
const playingMedia = 'J=(r.tagName==="VIDEO"||r.tagName==="AUDIO"&&a&&!e.forceSync&&ne<=.1*Math.abs(T))&&!r.paused&&e.playing';
const nativeVolume = 'r.volume=M,cl.set(r,M),e.onElementVolume?.(r,M,O),(t||e.isWebAudioOwned?.(r))';
const audibleVolume = 'r.volume=M,cl.set(r,M),e.onElementVolume?.(r,M,O);if(r.tagName==="AUDIO"&&M===0){r.paused||r.pause();ml(r);cl.set(r,M);continue}(t||e.isWebAudioOwned?.(r))';
const nativeAlignment = 'V=d&&ne>.001||r.ended&&h&&ne>.001||j||ne>pl&&(G||Y||U),';
const resumedAlignment = 'V=r.tagName==="AUDIO"&&r.paused&&e.playing&&ne>.06||d&&ne>.001||r.ended&&h&&ne>.001||j||ne>pl&&(G||Y||U),';
const nativePreload = 'Qy=(c,p,y)=>{let S=d.isPlaying();';
const managedPreload = 'Qy=(c,p,y)=>{if(document.documentElement.dataset.revlineMediaLoading==="managed")return;let S=d.isPlaying();';

export function patchHyperframesPlaybackRuntime(source, version) {
  if (version !== HYPERFRAMES_PLAYBACK_COMPAT_VERSION || source.split(original).length !== 2 || source.split(audioClockCandidate).length !== 2 || source.split(audioDrift).length !== 2 || source.split(playingVideo).length !== 2 || source.split(nativeVolume).length !== 2 || source.split(nativeAlignment).length !== 2 || source.split(nativePreload).length !== 2) throw new Error('Review the HyperFrames playback compatibility patches for this runtime version.');
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
  // Playing secondary audio uses the same gentle rate correction as video.
  // Hard-seeking every two drift samples discards buffered audio and produces
  // repeated seeking/waiting events. Limit this to 100ms of timeline drift so
  // a stable larger offset after preroll still hard-aligns within two samples.
  // Keep paused, preroll and forced sync exact.
  // Effective zero-gain audio needs no native decoder work. Evaluate automation
  // and the WebAudio gain callback first, then pause it and clear timing history.
  // Retain the last gain so live unmute can resolve its authored volume; align
  // the paused source before positive-gain playback resumes, but only when it is more
  // than 60ms off: a cut's preloaded audio is always a few ms behind the clock when it
  // starts, and hard-seeking it at every cut dropped ~50ms of sound. Rate correction
  // absorbs that small offset, as it does for video.
  // Revline's bounded warmup owns preview source preparation. Native visibility
  // deferral otherwise promotes extra streams and discards already prepared cuts.
  // Keep the studio marker for first-frame readiness and lazy image behavior.
  return source.replace(original, corrected).replace(audioClockCandidate, audibleClockCandidate).replace(audioDrift, scaledAudioDrift).replace(playingVideo, playingMedia).replace(nativeVolume, audibleVolume).replace(nativeAlignment, resumedAlignment).replace(nativePreload, managedPreload);
}
