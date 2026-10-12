export function formatRulerLabel(time:number){
  const value=Math.round(Math.max(0,time)*1000)/1000;
  if(value<60)return `${value}s`;
  const minutes=Math.floor(value/60);
  const seconds=Math.round((value-minutes*60)*1000)/1000;
  return `${minutes}m ${seconds<10?'0':''}${seconds}s`;
}

// OpenCut Classic ruler-utils.ts: choose label and tick spacing independently,
// keeping both frame aligned and ticks divisors of labeled intervals.
// MIT notice: third-party/OpenCut-LICENSE.
export function TimelineRulerTicks({px,duration,fps,origin=0}:{px:number;duration:number;fps:number;origin?:number}){
  const intervals=[2,3,5,10,15].map(frames=>frames/fps).concat([1,2,3,5,10,15,30,60,120,300,600]);
  const label=intervals.find(seconds=>seconds*px>=90)??600;
  const tick=[1,2,3,5,10,15].map(frames=>frames/fps).concat([1,2,3,5,10,15,30,60,120,300,600]).find(seconds=>seconds*px>=12&&Math.abs(label/seconds-Math.round(label/seconds))<.0001)??label;
  return Array.from({length:Math.ceil(duration/tick)+1},(_,index)=>{
    const time=index*tick,major=Math.abs(time/label-Math.round(time/label))<.0001;
    if(!major)return <i key={index} className="ruler-tick" style={{left:origin+time*px}} aria-hidden="true"/>;
    return <span key={index} style={{left:origin+time*px}}>{formatRulerLabel(time)}</span>;
  });
}
