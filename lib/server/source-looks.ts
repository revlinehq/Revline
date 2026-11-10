import { z } from 'zod';
import { withSourceFaceDecoder } from './source-face-decoder';

/** One native frame of a talking take, measured locally with MediaPipe: where the face is, how the head is
 * turned, whether the eyes are open and on the camera, and how much the picture moved since the sample before. */
const lookSample = z.object({
  time: z.number().nonnegative(),
  /** Face area as a share of the frame; 0 when no face was found. */
  face: z.number().min(0).max(1),
  /** Head turn in degrees: yaw left/right, pitch positive when the head tips down. */
  yaw: z.number().nullable(),
  pitch: z.number().nullable(),
  /** 0..1 eyelids closed, eyes looking down, eyes looking to a side. */
  blink: z.number().nullable(),
  down: z.number().nullable(),
  side: z.number().nullable(),
  /** Mean gray change against the previous sample (0..1) when that sample is at most 0.25 s earlier. */
  motion: z.number().nullable(),
});
const sourceLooks = z.object({ width: z.number().positive(), height: z.number().positive(), samples: z.array(lookSample) });
export type SourceLooks = z.infer<typeof sourceLooks>;
export const MAX_LOOK_SAMPLES = 480;

/** Decode the asked frames in the processor's browser and measure the largest face in each. No model service is called. */
export async function scanSourceLooks(source: string, times: number[], signal: AbortSignal, progress: (percent: number) => void): Promise<SourceLooks> {
  const ordered = [...new Set(times.map(time => Math.round(time * 1000) / 1000))].sort((a, b) => a - b).slice(0, MAX_LOOK_SAMPLES);
  return withSourceFaceDecoder(source, signal, async page => {
    await page.exposeFunction('reportProgress', progress);
    const result = await page.evaluate(async (times: number[]) => {
      const moduleUrl = `${location.origin}/vision.mjs`;
      const tasks: typeof import('@mediapipe/tasks-vision') = await import(/* webpackIgnore: true */ moduleUrl);
      const vision = await tasks.FilesetResolver.forVisionTasks('/wasm');
      // Independent images: a prediction carried across a cut or a jump between samples would be wrong.
      const landmarker = await tasks.FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: '/face-landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 2, minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
      const video = document.createElement('video');
      video.muted = true; video.preload = 'auto'; video.src = '/source.mp4'; document.body.appendChild(video);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Look analysis video loading timed out.')), 30_000);
          video.onloadeddata = () => { clearTimeout(timer); resolve(); };
          video.onerror = () => { clearTimeout(timer); reject(new Error('Look analysis video cannot be decoded.')); };
        });
        const width = video.videoWidth, height = video.videoHeight;
        const small = document.createElement('canvas'); small.width = 48; small.height = 48;
        const context = small.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Look analysis canvas is unavailable.');
        const samples: { time: number; face: number; yaw: number | null; pitch: number | null; blink: number | null; down: number | null; side: number | null; motion: number | null }[] = [];
        let previous: { time: number; gray: Float32Array } | undefined;
        for (const [index, time] of times.entries()) {
          if (Math.abs(video.currentTime - time) > .001) await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Look analysis seeking timed out.')), 20_000);
            video.onseeked = () => { clearTimeout(timer); resolve(); }; video.currentTime = time;
          });
          context.drawImage(video, 0, 0, 48, 48);
          const pixels = context.getImageData(0, 0, 48, 48).data, gray = new Float32Array(48 * 48);
          for (let i = 0; i < gray.length; i++) gray[i] = (pixels[i * 4] * .299 + pixels[i * 4 + 1] * .587 + pixels[i * 4 + 2] * .114) / 255;
          let motion: number | null = null;
          if (previous && time - previous.time <= .25) { let sum = 0; for (let i = 0; i < gray.length; i++) sum += Math.abs(gray[i] - previous.gray[i]); motion = sum / gray.length; }
          previous = { time, gray };
          const found = landmarker.detect(video);
          // The largest face is the speaker; a poster or a passer-by is smaller.
          let best = -1, area = 0;
          found.faceLandmarks.forEach((points, face) => {
            const xs = points.map(point => point.x), ys = points.map(point => point.y);
            const size = Math.max(0, Math.min(1, Math.max(...xs)) - Math.max(0, Math.min(...xs))) * Math.max(0, Math.min(1, Math.max(...ys)) - Math.max(0, Math.min(...ys)));
            if (size > area) { area = size; best = face; }
          });
          if (best < 0) { samples.push({ time, face: 0, yaw: null, pitch: null, blink: null, down: null, side: null, motion }); }
          else {
            const shape = new Map((found.faceBlendshapes?.[best]?.categories ?? []).map(category => [category.categoryName, category.score]));
            // No named helpers here: the worker's bundler wraps them with a helper this page does not have.
            const matrix = found.facialTransformationMatrixes?.[best]?.data, score = [0, 0, 0, 0, 0];
            for (const [slot, names] of [['eyeBlinkLeft', 'eyeBlinkRight'], ['eyeLookDownLeft', 'eyeLookDownRight'], ['eyeLookInLeft', 'eyeLookOutRight'], ['eyeLookOutLeft', 'eyeLookInRight']].entries())
              score[slot] = ((shape.get(names[0]) ?? 0) + (shape.get(names[1]) ?? 0)) / 2;
            // Column-major 4x4: rotation element (row, column) is data[column * 4 + row].
            samples.push({ time, face: Math.round(area * 10000) / 10000,
              yaw: matrix ? Math.round(Math.atan2(matrix[8], matrix[10]) * 1800 / Math.PI) / 10 : null,
              pitch: matrix ? Math.round(Math.asin(Math.max(-1, Math.min(1, matrix[9]))) * 1800 / Math.PI) / 10 : null,
              blink: shape.size ? Math.round(score[0] * 100) / 100 : null,
              down: shape.size ? Math.round(score[1] * 100) / 100 : null,
              // Both eyes to the same side: one looks in while the other looks out.
              side: shape.size ? Math.round(Math.max(score[2], score[3]) * 100) / 100 : null,
              motion });
          }
          await (Reflect.get(window, 'reportProgress') as (percent: number) => Promise<void>)(Math.round((index + 1) / times.length * 100));
        }
        return { width, height, samples };
      } finally { landmarker.close(); video.remove(); }
    }, ordered);
    return sourceLooks.parse(result);
  });
}
