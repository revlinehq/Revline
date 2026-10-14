import { expect, test } from 'vitest';
import { generateComposition } from './composition';
import type { Clip, Timeline } from './types';
const media:Clip[]=[{id:'from',kind:'video',assetId:'video',track:1,start:0,duration:2,sourceStart:1,volume:0},{id:'to',kind:'video',assetId:'video',track:1,start:2,duration:2,sourceStart:8,volume:0},{id:'sound',kind:'audio',assetId:'audio',track:1,start:0,duration:4,sourceStart:1}];
const assets=[{_id:'video',kind:'video' as const,fileName:'Fixture',url:'/fixture.mp4',width:1920,height:1080},{_id:'audio',kind:'audio' as const,fileName:'Fixture tone',url:'/fixture.mp4'}];
const timeline=(clips:Clip[],fps:24|30|60=30):Timeline=>({clips,fps,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:1,effects:1}});
const effect:Clip={id:'pair',kind:'effect',effectPreset:'spin-zoom',track:1,start:1.5,duration:1,sourceStart:0,transition:{fromClipId:'from',toClipId:'to',direction:'clockwise'}};
test('transition compiler preserves authored media/audio ranges and does not make a full-composite adjustment layer',()=>{
 const html=generateComposition(timeline([...media,effect]),assets);
 expect(html).not.toContain('data-effect-clip="pair"');
 expect(html).toContain('data-source-clip="from" data-start="0" data-duration="2" data-end="2"');
 expect(html).toContain('data-source-clip="to" data-start="2" data-duration="2" data-end="4"');
 expect(html).toContain('data-source-clip="sound" data-start="0" data-duration="4" data-end="4"');
 expect(html).toContain('data-media-start="8"');expect(html).toContain('window.__revlineRemotionTransitions.installTransitions(');
});
test('two project-frame transition remains legal when output frame rate is lower',()=>{
 expect(()=>generateComposition(timeline([...media,{...effect,start:2-1/60,duration:2/60}],60),assets,{fps:24})).not.toThrow();
});
test('ordinary preview does not initialize missing transitions, but loads the bridge for a retained first FX add',()=>{
 const html=generateComposition(timeline(media),assets,{preview:true});
 expect(html).toContain('src="/vendor/remotion-transitions.js"');expect(html).not.toContain('Transition renderer failed to load');
 const exported=generateComposition(timeline(media),assets);expect(exported).not.toContain('src="/vendor/remotion-transitions.js"');
});
