import { type CSSProperties } from 'react';
import { Easing, interpolate } from '@/lib/editor/frame-motion';
import { labProgress, type LabConfig } from './motion-lab-model';
import { MoreLabBlocks } from './motion-lab-more-blocks';
import './motion-lab-blocks.css';

const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
const bounded=(value:number)=>Math.max(0,Math.min(1,value));

/** A single reusable graphic, rendered on white and driven by the composition frame. */
export function MotionLabBlock({config,frame}:{config:LabConfig;frame:number}){
  const item=config.items[0],p=labProgress(config,frame,item.start),progress=bounded(p);
  const entranceAt=(sample:number):CSSProperties=>{const phase=labProgress(config,sample,item.start);return {opacity:bounded(phase),transform:config.blockEntrance==='rise'?`translateY(${(1-phase)*config.distance}px)`:config.blockEntrance==='scale'?`scale(${.7+phase*.3})`:undefined};};
  const style={'--block-accent':config.blockAccent,'--block-fill':config.blockFill,'--block-text':config.blockTextColor} as CSSProperties;
  const w=config.blockWidth,h=config.blockHeight,start={x:w*.1,y:h*.57},end={x:w*.9,y:h*.43},control={x:w*.5,y:h*(.5-config.blockBend*.5)};
  const arrowProgress=config.blockEntrance==='draw'?progress:1,q=1-arrowProgress;
  const tip={x:q*q*start.x+2*q*arrowProgress*control.x+arrowProgress*arrowProgress*end.x,y:q*q*start.y+2*q*arrowProgress*control.y+arrowProgress*arrowProgress*end.y};
  const tangent={x:2*q*(control.x-start.x)+2*arrowProgress*(end.x-control.x),y:2*q*(control.y-start.y)+2*arrowProgress*(end.y-control.y)};
  let headPoint=tip,headAngle=Math.atan2(tangent.y,tangent.x)*180/Math.PI;
  const rotation={right:0,left:180,up:-90,down:90}[config.blockDirection],head=Math.max(12,config.blockStroke*4);
  if(config.blockArrow==='straight'){headPoint={x:start.x+(end.x-start.x)*arrowProgress,y:h*.5};headAngle=0;}
  if(config.blockArrow==='elbow'){
    const first=w*.5-start.x,second=h*.4,last=end.x-w*.5,distance=(first+second+last)*arrowProgress;
    headPoint=distance<first?{x:start.x+distance,y:h*.3}:distance<first+second?{x:w*.5,y:h*.3+distance-first}:{x:w*.5+distance-first-second,y:h*.7};headAngle=distance>=first&&distance<first+second?90:0;
  }
  const path=config.blockArrow==='straight'?`M${start.x} ${h*.5}H${end.x}`:config.blockArrow==='elbow'?`M${start.x} ${h*.3}H${w*.5}V${h*.7}H${end.x}`:`M${start.x} ${start.y}Q${control.x} ${control.y} ${end.x} ${end.y}`;
  const labelCenter={x:config.blockDirection==='left'?w*.65:config.blockDirection==='right'?w*.35:w*.5,y:config.blockDirection==='up'?h*.68:h*.2};
  const labelWidth=w*.7,labelHeight=item.detail?76:52,anchor={x:config.blockAnchorX*w,y:config.blockAnchorY*h};
  const leaderStart={x:labelCenter.x,y:labelCenter.y+(anchor.y>labelCenter.y?labelHeight*.45:-labelHeight*.45)};
  const maximum=Math.max(1,...config.items.map(value=>value.value));
  const count=interpolate(frame-item.start*config.fps,[0,Math.max(1,config.entrance*config.fps*2)],[0,item.value],{...clamp,easing:Easing.out(Easing.cubic)});
  const number=`${config.counterPrefix}${Math.round(count).toLocaleString('en-US')}${config.counterSuffix}`;
  const content=config.scene==='block-card'?<article className="rmlab-block-card"><div className="rmlab-block-card-mark"><span/><span/><span/></div><h3>{item.label}</h3><p>{item.detail}</p>{config.blockShowMetric?<span className="rmlab-block-card-stat">{item.value.toLocaleString('en-US')}<i/></span>:null}</article>:
        config.scene==='block-arrow'?<svg className="rmlab-block-arrow" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={item.label||'Connector arrow'}><g transform={`rotate(${rotation} ${w/2} ${h/2})`}><path data-connector-path="" d={path} fill="none" stroke="var(--block-accent)" strokeWidth={config.blockStroke} strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={config.blockEntrance==='draw'?1-progress:0}/><path data-arrow-head="" d={`M${-head} ${-head*.48}L0 0L${-head} ${head*.48}`} transform={`translate(${headPoint.x} ${headPoint.y}) rotate(${headAngle})`} fill="none" stroke="var(--block-accent)" strokeWidth={config.blockStroke} strokeLinecap="round" strokeLinejoin="round" opacity={progress>.03?1:0}/></g>{item.label?<text x={w*.5} y={h-8} textAnchor="middle" fill="var(--block-text)" fontSize="14" fontWeight="500">{item.label}</text>:null}</svg>:
        config.scene==='block-label'?<div className="rmlab-block-callout"><svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path data-callout-leader="" d={`M${leaderStart.x} ${leaderStart.y}Q${leaderStart.x} ${anchor.y} ${anchor.x} ${anchor.y}`} fill="none" stroke="var(--block-accent)" strokeWidth={config.blockStroke} strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={config.blockEntrance==='draw'?1-progress:0}/><circle cx={anchor.x} cy={anchor.y} r="7" fill="none" stroke="var(--block-accent)" strokeOpacity=".2" strokeWidth="1.5"/><circle data-callout-target="" cx={anchor.x} cy={anchor.y} r="3.5" fill="var(--block-accent)"/></svg><div className="rmlab-block-label" style={{position:'absolute',left:labelCenter.x-labelWidth/2,top:labelCenter.y-labelHeight/2,width:labelWidth,minHeight:labelHeight}}><div><strong>{item.label}</strong>{item.detail?<span>{item.detail}</span>:null}</div></div></div>:
        config.scene==='block-counter'?<div className="rmlab-block-counter"><span style={{fontSize:Math.min(config.textSize,(config.blockWidth-20)/Math.max(1,number.length*.61))}}>{number}</span><strong>{item.label}</strong>{item.detail?<p>{item.detail}</p>:null}</div>:
        config.scene==='block-chart'?<div className="rmlab-block-chart">{config.items.map((bar,index)=><div key={index}><span className="rmlab-block-bar-space"><i style={{height:`${bar.value/maximum*bounded(labProgress(config,frame,item.start+index*.12))*100}%`}}><span>{bar.value.toLocaleString('en-US')}</span></i></span><strong>{bar.label}</strong></div>)}</div>:<MoreLabBlocks config={config} frame={frame}/>;
  return <div className="rmlab-scene rmlab-block-canvas" data-scene={config.scene} data-frame={frame} data-portrait={config.aspect==='portrait'} data-block-canvas="white" style={style}>
    {config.showGuides?<div className="rmlab-block-guides" aria-hidden="true"><i/><i/></div>:null}
    <div className="rmlab-block-position" style={{left:`${config.blockX*100}%`,top:`${config.blockY*100}%`,width:config.blockWidth,height:config.blockHeight,transform:`translate(-50%,-50%) rotate(${config.blockRotation}deg) scale(${config.blockScale})`}}>
      {config.blur>0?[4,3,2,1].map(sample=><div key={sample} className="rmlab-motion-sample" aria-hidden="true" style={{...entranceAt(frame-sample*config.blur/5),opacity:bounded(labProgress(config,frame-sample*config.blur/5,item.start))*.06,filter:`blur(${sample*.5}px)`}}>{content}</div>):null}
      <div className="rmlab-block-art" data-block-kind={config.scene} data-frame={frame} style={entranceAt(frame)}>{content}
      </div>
    </div>
  </div>;
}
