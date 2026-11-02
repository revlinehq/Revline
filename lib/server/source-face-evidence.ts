import { z } from 'zod';
import { normalizedRect } from '../media-analysis/clipping';
import { withSourceFaceDecoder } from './source-face-decoder';

const face = normalizedRect.safeExtend({ confidence: z.number().min(0).max(1), mouth: z.number().nonnegative().nullable(), appearance: z.array(z.number().min(0).max(1)).length(88).optional() });
const sourceFaceEvidence = z.object({ width: z.number().positive(), height: z.number().positive(), samples: z.array(z.object({ time: z.number().nonnegative(), faces: z.array(face) })) });
export type SourceFaceEvidence = z.infer<typeof sourceFaceEvidence>;

/** Decode native frames in the processor. Corner tiles preserve small webcam faces. */
export async function scanSourceFaces(source: string, times: number[], mesh: boolean, signal: AbortSignal, progress: (percent: number) => void): Promise<SourceFaceEvidence> {
  return withSourceFaceDecoder(source, signal, async page => {
    await page.exposeFunction('reportProgress', progress);
    const result = await page.evaluate(async ({ times, mesh }) => {
      const moduleUrl = `${location.origin}/vision.mjs`;
      const tasks: typeof import('@mediapipe/tasks-vision') = await import(/* webpackIgnore: true */ moduleUrl);
      const vision = await tasks.FilesetResolver.forVisionTasks('/wasm');
      const detector = await tasks.FaceDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: '/blaze-face.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: .6 });
      // Independent images avoid carrying a landmark prediction through a camera cut.
      const landmarker = mesh ? await tasks.FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: '/face-landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 4, minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5 }) : null;
      const video = document.createElement('video');
      video.muted = true; video.preload = 'auto'; video.src = '/source.mp4'; document.body.appendChild(video);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Face analysis video loading timed out.')), 30_000);
          video.onloadeddata = () => { clearTimeout(timer); resolve(); };
          video.onerror = () => { clearTimeout(timer); reject(new Error('Face analysis video cannot be decoded.')); };
        });
        const width = video.videoWidth, height = video.videoHeight, samples: SourceFaceEvidence['samples'] = [];
        const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
        if (!context) throw new Error('Face analysis canvas is unavailable.');
        for (const [index, time] of times.entries()) {
          if (Math.abs(video.currentTime - time) > .001) await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Face analysis seeking timed out.')), 20_000);
            video.onseeked = () => { clearTimeout(timer); resolve(); }; video.currentTime = time;
          });
          const faces: SourceFaceEvidence['samples'][number]['faces'] = [];
          if (landmarker) {
            const result = landmarker.detect(video);
            for (const points of result.faceLandmarks) {
              const left = Math.max(0, Math.min(...points.map(p => p.x))), top = Math.max(0, Math.min(...points.map(p => p.y)));
              const right = Math.min(1, Math.max(...points.map(p => p.x))), bottom = Math.min(1, Math.max(...points.map(p => p.y)));
              const a = points[13], b = points[14], c = points[78], d = points[308];
              if (!a || !b || !c || !d || right <= left || bottom <= top) continue;
              const mouthWidth = Math.hypot((c.x - d.x) * width, (c.y - d.y) * height);
              if (mouthWidth < 1) continue;
              faces.push({ x: left, y: top, w: right - left, h: bottom - top, confidence: 1, mouth: Math.hypot((a.x - b.x) * width, (a.y - b.y) * height) / mouthWidth });
            }
          }
          {
            // A profile or microphone may hide the lips while the face remains detectable.
            const tiles = [{ x: 0, y: 0, w: 1, h: 1 }, ...(mesh ? [] : [.6, .3].flatMap(size => {
              const positions = size === .6 ? [0, .4] : [0, .7 / 3, 1.4 / 3, .7];
              return positions.flatMap(x => positions.map(y => ({ x, y, w: size, h: size })));
            }))];
            for (const tile of tiles) {
              canvas.width = Math.round(width * tile.w); canvas.height = Math.round(height * tile.h);
              context.drawImage(video, width * tile.x, height * tile.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
              for (const detection of detector.detect(canvas).detections) {
                const box = detection.boundingBox;
                if (!box) continue;
                const x = Math.max(0, tile.x + box.originX / width), y = Math.max(0, tile.y + box.originY / height);
                const w = Math.min(1 - x, box.width / width), h = Math.min(1 - y, box.height / height);
                if (!(w > 0 && h > 0)) continue;
                const candidate = { x, y, w, h, confidence: detection.categories[0]?.score ?? 0, mouth: null };
                const duplicate = faces.find(f => Math.hypot(f.x + f.w / 2 - x - w / 2, f.y + f.h / 2 - y - h / 2) < Math.min(f.w, w) * .4);
                if (!duplicate) faces.push(candidate);
                else if (duplicate.mouth === null && candidate.confidence > duplicate.confidence) Object.assign(duplicate, candidate);
              }
            }
          }
          if (mesh) {
            canvas.width = 8; canvas.height = 8;
            for (const face of faces) {
              context.drawImage(video, (face.x + face.w * .15) * width, (face.y + face.h * .1) * height, face.w * .7 * width, face.h * .8 * height, 0, 0, 8, 8);
              const pixels = context.getImageData(0, 0, 8, 8).data, luminance: number[] = [], histogram = Array<number>(24).fill(0);
              for (let i = 0; i < pixels.length; i += 4) {
                luminance.push((pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114) / 255);
                for (let channel = 0; channel < 3; channel++) histogram[channel * 8 + Math.min(7, Math.floor(pixels[i + channel] / 32))] += 1 / 64;
              }
              const average = luminance.reduce((sum, value) => sum + value, 0) / 64;
              face.appearance = [...luminance.map(value => Math.max(0, Math.min(1, value - average + .5))), ...histogram];
            }
          }
          samples.push({ time, faces });
          // The callback belongs to this isolated worker page.
          await pageProgress(Math.round((index + 1) / times.length * 100));
        }
        return { width, height, samples };
      } finally { detector?.close(); landmarker?.close(); video.remove(); }

      function pageProgress(percent: number): Promise<void> {
        return Reflect.get(window, 'reportProgress')(percent);
      }
    }, { times, mesh });
    return sourceFaceEvidence.parse(result);
  });
}
