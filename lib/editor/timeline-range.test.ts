import { expect, it } from 'vitest';
import { moveSelectedClips } from './timeline-controls';
import { generateComposition } from './composition';
import { pasteTimelineClips } from './clipboard';
import type { Timeline } from './types';
const timeline:Timeline={fps:30,aspectRatio:'vertical',clips:[{id:'small',kind:'graphic',start:290,duration:10,sourceStart:0,text:'Move me'}]};
it('moves and previews the clip past the old five-minute wall',()=>{
  const moved=moveSelectedClips(timeline,['small'],310,0);
  expect(moved.clips[0].start).toBe(600);
  expect(generateComposition(moved,[])).toContain('data-duration="610"');
  expect(pasteTimelineClips(timeline,timeline.clips,720,()=> 'copy').timeline.clips.at(-1)?.start).toBe(720);
});
