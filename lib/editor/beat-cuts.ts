import { Timeline, MediaAsset, trackOf } from './types';
import { patchClip } from './operations';
import { sourceEndOf, timelineTimeAtSource } from './playback-rate';
/** Move shot boundaries to measured beats, without exceeding any source file. */
export function alignCutsToBeats(timeline:Timeline,assets:MediaAsset[],musicAssetId:string,beats:number[],track=1):Timeline {
  const music=timeline.clips.find(c=>c.assetId===musicAssetId);if(!music)throw new Error('Add the analyzed audio or video to the timeline first.');
  const mapped=beats.filter(b=>b>=music.sourceStart&&b<sourceEndOf(music)).map(b=>timelineTimeAtSource(music,b)).filter(b=>b>music.start+.2&&b<music.start+music.duration-.2);
  if(mapped.length<2)throw new Error('There are not enough clear beats to align these cuts.');
  const shots=timeline.clips.filter(c=>(c.kind==='video'||c.kind==='image')&&trackOf(c)===track).sort((a,b)=>a.start-b.start);
  if(shots.some((shot,index)=>index>0&&shot.start<shots[index-1].start+shots[index-1].duration-.001))throw new Error('Separate overlapping footage into different layers before aligning beats.');
  if(shots.length<2)throw new Error('Add at least two shots to align their cuts to the music.');
  const end=shots.at(-1)!.start+shots.at(-1)!.duration;const start=shots[0].start;
  const boundaries=[start];for(let i=1;i<shots.length;i++){const desired=start+(end-start)*i/shots.length;const available=mapped.filter(b=>b>boundaries.at(-1)!+.15&&b<end-.15*(shots.length-i));if(!available.length)throw new Error('Not enough space between beats for this many shots.');boundaries.push(available.reduce((a,b)=>Math.abs(b-desired)<Math.abs(a-desired)?b:a));}boundaries.push(end);
  const replacements=new Map(shots.map((clip,i)=>{const duration=boundaries[i+1]-boundaries[i];const asset=assets.find(a=>a._id===clip.assetId);if(clip.kind==='video'&&asset?.duration!==undefined&&sourceEndOf({...clip,duration})>asset.duration+.001)throw new Error('A shot is too short to reach the next beat. Choose longer source footage or trim the sequence.');return [clip.id,{...clip,start:boundaries[i],duration}];}));
  return [...replacements.values()].reduce((next, clip) => patchClip(next, clip.id, { start: clip.start, duration: clip.duration }), timeline);
}
