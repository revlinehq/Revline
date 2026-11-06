import { clampOrFallback as bounded } from '../math';
import { DEFAULT_CROP, type ClipFlip, type SourceCrop } from './types';


/** Crop masks the source without changing its existing scale or placement. */
export function calculateVisualRect(sourceWidth: number, sourceHeight: number, frameWidth: number, frameHeight: number, crop: SourceCrop = DEFAULT_CROP, focus?: { x: number; y: number }, fit: 'cover' | 'contain' = 'cover') {
  if (![sourceWidth, sourceHeight, frameWidth, frameHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error('Crop needs the source dimensions. Re-import this media.');
  if (![crop.left, crop.top, crop.right, crop.bottom].every(value => Number.isFinite(value) && value >= 0 && value <= 0.95) || crop.left + crop.right >= 0.95 || crop.top + crop.bottom >= 0.95) throw new Error('Crop edges must leave at least 5% of the source visible.');
  const scale = (fit === 'contain' ? Math.min : Math.max)(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const width = sourceWidth * scale, height = sourceHeight * scale;
  const left = fit === 'contain' ? (frameWidth-width)/2 : Math.min(0,Math.max(frameWidth-width,frameWidth/2-bounded(focus?.x,.5,0,1)*width));
  const top = fit === 'contain' ? (frameHeight-height)/2 : Math.min(0,Math.max(frameHeight-height,frameHeight/2-bounded(focus?.y,.5,0,1)*height));
  const windowLeft = Math.max(0,left+crop.left*width), windowTop = Math.max(0,top+crop.top*height);
  const windowRight = Math.min(frameWidth,left+(1-crop.right)*width), windowBottom = Math.min(frameHeight,top+(1-crop.bottom)*height);
  return { left,top,width,height,window:{left:windowLeft,top:windowTop,width:Math.max(0,windowRight-windowLeft),height:Math.max(0,windowBottom-windowTop)} };
}

/** CSS for a clip flip on its source window, so the mirrored picture keeps the same crop window in preview and export. */
export function flipStyle(flip?: ClipFlip) {
  return flip?.horizontal || flip?.vertical ? `scale(${flip.horizontal ? -1 : 1},${flip.vertical ? -1 : 1})` : '';
}
