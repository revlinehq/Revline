import { labProgress, type LabConfig } from './motion-lab-model';
import './motion-lab-more-blocks.css';

const bounded=(value:number)=>Math.max(0,Math.min(1,value));

export function MoreLabBlocks({config,frame}:{config:LabConfig;frame:number}){
  const item=config.items[0],progress=bounded(labProgress(config,frame,item.start)),value=Math.max(0,Math.min(100,item.value))*progress;
  const w=config.blockWidth,h=config.blockHeight,radius=Math.max(18,Math.min(w,h)/2-16);
  const number=`${config.counterPrefix}${Math.round(item.value*progress).toLocaleString('en-US')}${config.counterSuffix}`;
  if(config.scene==='block-progress-ring')return <div className="rmlab-graphic-ring"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${item.label}: ${Math.round(value)} percent`}><circle cx={w/2} cy={h/2} r={radius} fill="none" stroke="#eceef4" strokeWidth={config.blockStroke*2}/><circle cx={w/2} cy={h/2} r={radius} fill="none" stroke="var(--block-accent)" strokeWidth={config.blockStroke*2} strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={100-value} transform={`rotate(-90 ${w/2} ${h/2})`}/></svg><div><strong>{Math.round(value)}<small>%</small></strong><span>{item.label}</span></div></div>;
  if(config.scene==='block-progress-bar')return <div className="rmlab-graphic-progress"><header><strong>{item.label}</strong><span>{Math.round(value)}%</span></header><div><i style={{width:`${value}%`}}/></div>{item.detail?<p>{item.detail}</p>:null}</div>;
  if(config.scene==='block-stat-badge')return <div className="rmlab-graphic-stat"><span>{item.label}</span><strong style={{fontSize:Math.min(config.textSize,(w-40)/Math.max(1,number.length*.6))}}>{number}</strong>{item.detail?<p>{item.detail}</p>:null}</div>;
  if(config.scene==='block-checklist'||config.scene==='block-steps')return <div className={`rmlab-graphic-list ${config.scene==='block-steps'?'rmlab-graphic-steps':''}`}>{config.items.map((row,index)=>{
    const p=bounded(labProgress(config,frame,item.start+index*.12));
    return <div key={index} style={{opacity:p,transform:`translateX(${(1-p)*12}px)`}}><i data-checked={config.blockChecks[index]}>{config.scene==='block-steps'?index+1:config.blockChecks[index]?<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>:null}</i><span><strong>{row.label}</strong>{config.scene==='block-steps'&&row.detail?<small>{row.detail}</small>:null}</span></div>;
  })}</div>;
  if(config.scene==='block-quote')return <blockquote className="rmlab-graphic-quote"><i aria-hidden="true">“</i><p>{item.detail}</p><footer>{item.label}</footer></blockquote>;
  if(config.scene==='block-comparison')return <div className="rmlab-graphic-comparison">{config.items.slice(0,2).map((side,index)=><div key={index}><small>{side.label}</small><strong>{Math.round(side.value*progress).toLocaleString('en-US')}</strong>{side.detail?<span>{side.detail}</span>:null}</div>)}<i>vs</i></div>;
  if(config.scene==='block-marker')return <div className="rmlab-graphic-marker"><svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={`M8 ${h*.4}H${w-8}`} stroke="#dfe3ed" strokeWidth="2"/><path d={`M${w*config.blockAnchorX} ${h*.4-16}V${h*.4+16}`} stroke="var(--block-accent)" strokeWidth={config.blockStroke}/><circle cx={w*config.blockAnchorX} cy={h*.4} r="5" fill="var(--block-accent)"/></svg><div style={{left:`${config.blockAnchorX*100}%`,top:'55%'}}><strong>{item.label}</strong>{item.detail?<span>{item.detail}</span>:null}</div></div>;
  if(config.scene==='block-highlight')return <svg className="rmlab-graphic-highlight" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={item.label||'Highlight circle'}><ellipse cx={w/2} cy={h/2} rx={Math.max(1,w/2-10)} ry={Math.max(1,h/2-10)} fill="none" stroke="var(--block-accent)" strokeWidth={config.blockStroke} strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={config.blockEntrance==='draw'?1-progress:0}/>{item.label?<text x={w/2} y={h/2} textAnchor="middle" dominantBaseline="middle" fill="var(--block-text)" fontSize="19" fontWeight="500">{item.label}</text>:null}</svg>;
  return <div className="rmlab-graphic-lower-third"><i/><div><strong>{item.label}</strong>{item.detail?<span>{item.detail}</span>:null}</div></div>;
}
