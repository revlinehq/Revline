import { memo } from 'react';

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
export const TimelineRulerTicks = memo(function TimelineRulerTicks({px,duration,fps,origin=0}:{px:number;duration:number;fps:number;origin?:number}){
  const intervals=[2,3,5,10,15].map(frames=>frames/fps).concat([1,2,3,5,10,15,30,60,120,300,600]);
  const label=intervals.find(seconds=>seconds*px>=90)??600;
  const tick=[1,2,3,5,10,15].map(frames=>frames/fps).concat([1,2,3,5,10,15,30,60,120,300,600]).find(seconds=>seconds*px>=12&&Math.abs(label/seconds-Math.round(label/seconds))<.0001)??label;
  const labels:React.ReactNode[]=[];
  let path='';
  for(let index=0;index<=Math.ceil(duration/tick);index++){
    const time=index*tick,major=Math.abs(time/label-Math.round(time/label))<.0001;
    const x=Math.round(origin+time*px)+.5;
    path+=`M${x} ${major?19:23}V27`;
    if(major)labels.push(<span key={index} style={{left:origin+time*px}}>{formatRulerLabel(time)}</span>);
  }
  return <><svg className="ruler-ticks" width={Math.ceil(origin+duration*px)+2} height={28} aria-hidden="true"><path d={path}/></svg>{labels}</>;
});
