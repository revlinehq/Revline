import assert from 'node:assert/strict';
import sharp from 'sharp';

// Pass a browser screenshot and the selected clip's bounds in screenshot pixels:
// node scripts/timeline-selection-paint-check.mjs screenshot.png x y width height
// If the playhead crosses this clip, append --playhead-x with its screen center.
const [path,...arguments_]=process.argv.slice(2);
const bounds=arguments_.slice(0,4),options=arguments_.slice(4);
assert.ok(path&&bounds.length===4,'Supply a screenshot path and x y width height bounds');
assert.ok(options.length===0||(options.length===2&&options[0]==='--playhead-x'),'Only --playhead-x <screen position> is supported');
const playheadX=options.length?Number(options[1]):null;
assert.ok(playheadX===null||Number.isFinite(playheadX),'Playhead position must be finite');
const [x,y,width,height]=bounds.map(value=>Math.floor(Number(value)));
assert.ok([x,y,width,height].every(Number.isFinite)&&width>12&&height>12,'Bounds must describe a clip larger than 12px');
const source=sharp(path);
const {format}=await source.metadata();
const {data,info}=await source.removeAlpha().raw().toBuffer({resolveWithObject:true});
assert.ok(x>=0&&y>=0&&x+width<=info.width&&y+height<=info.height,'Clip bounds must fit the screenshot');
const pixel=(x,y)=>{
  const index=(y*info.width+x)*info.channels;
  return [...data.subarray(index,index+3)];
};
// Skip rounded corners; a visible 65%-white stroke has every channel >=166.
// Allow rasterization variance while requiring continuity on each edge.
const coordinates={
  left:Array.from({length:height-12},(_,i)=>[x,y+6+i]),
  right:Array.from({length:height-12},(_,i)=>[x+width-1,y+6+i]),
  top:Array.from({length:width-12},(_,i)=>[x+6+i,y]),
  bottom:Array.from({length:width-12},(_,i)=>[x+6+i,y+height-1]),
};
// Browser tool captures can be JPEG despite a .png extension. Compression blurs
// a 1px stroke across adjacent pixels; search 1px perpendicular to that edge.
const tolerance=format==='jpeg'?1:0;
// The playhead intentionally paints above selection. JPEG chroma compression
// spreads its 1px blue line across nearby columns; don't test that intersection.
const occlusionRadius=playheadX===null?0:format==='jpeg'?3:.75;
const edges=Object.fromEntries(Object.entries(coordinates).map(([edge,points])=>[
  edge,(()=>{
    const unobscured=points.filter(([x])=>playheadX===null||Math.abs(x-playheadX)>occlusionRadius);
    return {visible:unobscured.filter(([x,y])=>{
    for(let delta=-tolerance;delta<=tolerance;delta++){
      const px=x+(['left','right'].includes(edge)?delta:0);
      const py=y+(['top','bottom'].includes(edge)?delta:0);
      if(px>=0&&py>=0&&px<info.width&&py<info.height&&Math.min(...pixel(px,py))>=155)return true;
    }
    return false;
    }).length,total:unobscured.length,occluded:points.length-unobscured.length};
  })(),
]));
console.log(JSON.stringify({path,format,tolerance,playheadX,occlusionRadius,bounds:{x,y,width,height},edges}));
assert.ok(Object.values(edges).filter(result=>result.total>0).length>=2,'At least two selection edges must remain unobscured');
for(const [edge,result]of Object.entries(edges)){
  if(!result.total)continue;
  assert.ok(result.visible/result.total>=.9,`${edge} selected edge is obscured: ${result.visible}/${result.total} painted stroke pixels`);
}
