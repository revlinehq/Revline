import { Timeline, MediaAsset, trackOf } from './types';
import { patchClip, snapTime } from './operations';
import { sourceEndOf, timelineTimeAtSource } from './playback-rate';
/** Snap each cut between shots (footage, images or motion scenes), and the sequence's end, to the nearest measured beat, without exceeding any source file. */
export function alignCutsToBeats(timeline:Timeline,assets:MediaAsset[],musicAssetId:string,beats:number[],track=1):Timeline {
  const musicClips=timeline.clips.filter(c=>c.assetId===musicAssetId);if(!musicClips.length)throw new Error('Add the analyzed audio or video to the timeline first.');
  const shots=timeline.clips.filter(c=>(c.kind==='video'||c.kind==='image'||c.kind==='scene')&&trackOf(c)===track).sort((a,b)=>a.start-b.start);
  if(shots.some((shot,index)=>index>0&&shot.start<shots[index-1].start+shots[index-1].duration-.001))throw new Error('Separate overlapping footage into different layers before aligning beats.');
  if(!shots.length)throw new Error('Add footage, an image or a motion scene on V1 to align it to the music.');
  // Every shot after the first moves when its cut moves, and its linked audio moves with it.
  // Music carried by those shots cannot give fixed beat times: snapping a cut would move the beat too.
  const moving=new Set(shots.slice(1).flatMap(shot=>[shot.id,...shot.linkedClipId?[shot.linkedClipId]:[]]));
  const carriedBy=(c:Timeline['clips'][number])=>moving.has(c.id)||(c.linkedClipId!==undefined&&moving.has(c.linkedClipId));
  const audible=(c:Timeline['clips'][number])=>(c.volume??1)>0&&!(c.kind==='video'&&c.audioSeparated);
  // Muted copies of the song inside the shots are harmless; the fixed clips set the beats.
  const carried=musicClips.filter(c=>carriedBy(c)&&audible(c)),fixed=musicClips.filter(c=>!carriedBy(c));
  if(carried.length||!fixed.length){
    const shown=carried.length?carried:musicClips.filter(carriedBy),one=shown.length===1;
    const named=shown.slice(0,3).map(c=>`${c.id} at ${Math.round(c.start*100)/100}s`).join(', ');
    throw new Error(`alignCutsToBeat does not support this layout: the music comes from the clips' own audio (${shown.length} clip${one?'':'s'} play${one?'s its':' their'} own part of asset ${musicAssetId}: ${named}${shown.length>3?', …':''}), so moving a cut moves that music with it. Use one continuous music clip: place the song on an audio track as its own clip, mute or unlink the clips' own audio, then run alignCutsToBeat with that song's asset.`);
  }
  // Cuts land on project frames. Beats that round to the same frame collapse
  // into one candidate, so chosen boundaries stay strictly increasing. Rounding
  // may pass a source end by under half a frame, inside the saved-timeline tolerance.
  // A song split into several pieces that stay put contributes each piece's own beats.
  const mapped=[...new Set(fixed.flatMap(music=>beats.filter(b=>b>=music.sourceStart&&b<sourceEndOf(music)).map(b=>snapTime(timelineTimeAtSource(music,b),timeline.fps)).filter(b=>b>music.start+.2&&b<music.start+music.duration-.2)))].sort((a,b)=>a-b);
  if(mapped.length<2)throw new Error('There are not enough clear beats to align these cuts.');
  const end=shots.at(-1)!.start+shots.at(-1)!.duration;const start=shots[0].start;
  const boundaries=[start];for(let i=1;i<shots.length;i++){const desired=shots[i].start;const available=mapped.filter(b=>b>boundaries.at(-1)!+.15&&b<end-.15*(shots.length-i));if(!available.length)throw new Error('Not enough space between beats for this many shots.');boundaries.push(available.reduce((a,b)=>Math.abs(b-desired)<Math.abs(a-desired)?b:a));}
  // The sequence also ends on the beat nearest its end (within a second), unless the last footage runs out first.
  const last=shots.at(-1)!,lastAsset=assets.find(a=>a._id===last.assetId);
  const fits=(boundary:number)=>last.kind!=='video'||lastAsset?.duration===undefined||sourceEndOf({...last,duration:boundary-boundaries.at(-1)!})<=lastAsset.duration+.5/timeline.fps+.001;
  const ends=mapped.filter(b=>b>boundaries.at(-1)!+.15&&Math.abs(b-end)<=1&&fits(b));
  boundaries.push(ends.length?ends.reduce((a,b)=>Math.abs(b-end)<Math.abs(a-end)?b:a):end);
  const replacements=new Map(shots.map((clip,i)=>{const duration=boundaries[i+1]-boundaries[i];const asset=assets.find(a=>a._id===clip.assetId);if(clip.kind==='video'&&asset?.duration!==undefined&&sourceEndOf({...clip,duration})>asset.duration+.5/timeline.fps+.001)throw new Error('A shot is too short to reach the next beat. Choose longer source footage or trim the sequence.');return [clip.id,{...clip,start:boundaries[i],duration}];}));
  return [...replacements.values()].reduce((next, clip) => patchClip(next, clip.id, { start: clip.start, duration: clip.duration }), timeline);
}
