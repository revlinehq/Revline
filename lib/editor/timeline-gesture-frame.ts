/** Share one paint/update slot across pointer moves and edge-scroll notifications. */
export function timelineGestureFrame(update:()=>void){
  let frame:number|null=null;
  const cancel=()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;};
  return {
    request(){if(frame===null)frame=requestAnimationFrame(()=>{frame=null;update();});},
    flush(){cancel();update();},
    cancel,
  };
}
