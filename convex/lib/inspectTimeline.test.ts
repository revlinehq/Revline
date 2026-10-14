import {expect,test} from 'vitest';
import {summarizeTimeline} from './inspectTimeline';
import {textAnimationPatch} from '../../lib/editor/text-effects';
import {NEUTRAL_MOTION} from '../../lib/editor/clip-effects';
import {type Clip,type Timeline} from '../../lib/editor/types';

const base:Clip={id:'caption',kind:'caption',track:1,start:0,duration:2,sourceStart:0,text:'Saved words'};
const inspect=(clip:Clip)=>summarizeTimeline({fps:30,aspectRatio:'landscape',clips:[clip]} as Timeline,[]);

test('inspection describes Pop in from its actual keyframes despite the neutral basic animation field',()=>{
  const clip={...base,...textAnimationPatch(base,'pop')};
  expect(clip.animation).toBe('none');
  expect(inspect(clip).textAnimations).toEqual([{clipId:'caption',labels:['Pop in']}]);
});

test('inspection reports simultaneous outer/template animation and distinguishes custom keys from None',()=>{
  expect(inspect({...base,animation:'fade',textTemplate:{preset:'word-reveal',duration:2,offset:0}}).textAnimations).toEqual([{clipId:'caption',labels:['Fade','Word reveal']}]);
  expect(inspect({...base,animation:'none',motion:[{...NEUTRAL_MOTION,time:0},{...NEUTRAL_MOTION,time:2,x:.2}]}).textAnimations).toEqual([{clipId:'caption',labels:['Custom keyframe motion']}]);
  expect(inspect({...base,animation:'none'}).textAnimations).toEqual([{clipId:'caption',labels:['None']}]);
});
