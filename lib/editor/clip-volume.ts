/** Drag relative to the grab point so catching the line never jumps the gain. */
export function clipVolumeAtPointer(volume:number,startY:number,pointerY:number,height:number){
  return Math.round(Math.max(0,Math.min(1,volume+(startY-pointerY)/Math.max(1,height)))*100)/100;
}
