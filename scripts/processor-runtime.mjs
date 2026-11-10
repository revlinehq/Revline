// Files under scripts/ that the media processor image runs, spawns or reads
// without a static import. prepare-context.mjs copies them into the image and
// processor-changes.mjs releases the processor when one of them changes.
export const PROCESSOR_SCRIPTS = Object.freeze([
  'render-worker.mjs', 'render-gpu.mjs', 'render-distributed.mjs', 'render-railway-chunks.mjs', 'render-chunk.mjs', 'render-artifacts.mjs', 'render-ffmpeg.sh', 'composition-review-worker.mjs',
  'track-pixels.py', 'source_frames.py', 'detect-facecam.py', 'detect-shots.py', 'detect-beats.py',
  'install-beat-model.mjs', 'copy-vendor.mjs', 'hyperframes-playback-compat.mjs',
  'beat-tracking-requirements.txt', 'scene-detection-requirements.txt', 'video-import-requirements.txt',
]);
