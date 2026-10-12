import { MediaAsset, Timeline } from './types';
export const PORTRAIT_URL = 'https://images.unsplash.com/photo-1680983387184-1d5d0c3fa190?auto=format&fit=crop&q=80&w=1080';
export const COFFEE_URL = 'https://images.unsplash.com/photo-1635906108925-2ee3d3dd1ec4?auto=format&fit=crop&q=80&w=1080';
export const DEMO_ASSETS: MediaAsset[] = [
  { _id:'demo-portrait',fileName:'weekend_outside.jpg',kind:'image',url:PORTRAIT_URL,duration:5 },
  { _id:'demo-coffee',fileName:'morning_coffee.jpg',kind:'image',url:COFFEE_URL,duration:5 },
];
export const DEMO_TIMELINE: Timeline = { fps:30,aspectRatio:'vertical',clips:[
  ...Array.from({length:9},(_,i)=>({id:`shot-${i}`,kind:'image' as const,assetId:i%3===1?'demo-coffee':'demo-portrait',start:i*15/9,duration:15/9,sourceStart:0})),
  ...['A little more outside.','A little less on your phone.','Find your own rhythm.','Make room for the good stuff.','Your next story starts here.'].map((text,i)=>({id:`caption-${i}`,kind:'caption' as const,start:i*3+.15,duration:2.65,sourceStart:0,text,fontSize:42,color:'#F4F4F0',background:'#0B0C0E',x:.5,y:.83,animation:'fade' as const})),
  {id:'title-1',kind:'graphic',start:0,duration:6,sourceStart:0,text:'MAKE ROOM\nFOR OUTSIDE.',fontSize:108,color:'#F4F4F0',background:'transparent',x:.5,y:.72,animation:'none'},
  {id:'title-2',kind:'graphic',start:12,duration:3,sourceStart:0,text:'START\nSOMETHING.',fontSize:108,color:'#F4F4F0',background:'transparent',x:.5,y:.56,animation:'rise'},
] };
