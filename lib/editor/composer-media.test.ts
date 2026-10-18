import { expect, test } from 'vitest';
import { composerMedia } from './composer-media';
import type { MediaAsset } from './types';
const assets = [
  {_id:'old',fileName:'Old footage',kind:'video',url:'source'},
  {_id:'new',fileName:'Added footage',kind:'video',url:'large-source',thumbnailUrl:'poster'},
  {_id:'audio',fileName:'Extracted audio',kind:'audio',url:'audio'},
  {_id:'photo',fileName:'Extra image',kind:'image',url:'photo'},
] as MediaAsset[];
test('new attachments use saved poster and never mount another video decoder or duplicate separated audio',()=>{
  expect(composerMedia(assets,['new','new','missing'])).toEqual([{id:'new',name:'Added footage',url:'poster',kind:'image',error:undefined}]);
  expect(composerMedia(assets,['old'])[0].url).toBeUndefined();
  expect(composerMedia(assets,['photo'])[0].url).toBe('photo');
  expect(composerMedia(assets,[])).toEqual([]);
});
