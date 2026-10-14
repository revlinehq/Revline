/** Vertical scrolling starts at the visible track boundaries, not inside a lane. */
export function verticalEdgeScrollSpeed(pointerY:number,top:number,bottom:number,scrollTop:number,maxScroll:number) {
  if (pointerY <= top && scrollTop > 0) return -Math.min(15, 2 + (top-pointerY)*.4);
  if (pointerY >= bottom && scrollTop < maxScroll) return Math.min(15, 2 + (pointerY-bottom)*.4);
  return 0;
}
