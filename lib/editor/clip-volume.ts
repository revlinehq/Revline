export const MAX_CLIP_VOLUME = 2;

/** A small unity notch makes the original level easy to recover with the pointer. */
export function clipVolumeAtFraction(fraction:number){
  const volume=Math.max(0,Math.min(MAX_CLIP_VOLUME,fraction*MAX_CLIP_VOLUME));
  return Math.abs(volume-1)<.03?1:Math.round(volume*100)/100;
}
/** Drag relative to the grab point so catching the line never jumps the gain. */
export function clipVolumeAtPointer(volume:number,startY:number,pointerY:number,height:number){
  if(startY===pointerY)return volume;
  return clipVolumeAtFraction(volume/MAX_CLIP_VOLUME+(startY-pointerY)/Math.max(1,height));
}
