import { expect, test } from 'vitest';
import { moveText, resizeText, snapTextMove } from './text-transforms';
const initial={x:.5,y:.5,fontSize:60};
test('moves in canvas coordinates, clamps and allows Shift to bypass center snap',()=>{
 expect(moveText(initial,20,40,200,400,false)).toEqual({x:.6,y:.6,fontSize:60});
 expect(moveText(initial,3,2,200,400)).toEqual(initial);
 expect(moveText(initial,3,2,200,400,false).x).toBe(.515);
 expect(moveText(initial,-999,999,200,400,false)).toEqual({x:0,y:1,fontSize:60});
});
test('text alignment magnets use its visible edges and screen pixels',()=>{
 const proposed=moveText(initial,-84,174,200,400,false);
 const result=snapTextMove(proposed,{width:40,height:60},{width:200,height:400});
 expect(result.placement.x).toBe(.1);
 expect(result.placement.y).toBe(.925);
 expect(result.lines).toContainEqual({axis:'x',position:0});
 expect(result.lines).toContainEqual({axis:'y',position:400});
 expect(snapTextMove(proposed,{width:40,height:60},{width:400,height:800}).placement).toEqual(proposed);
});
test('text resize keeps the opposite corner anchored and clamps the source font size',()=>{
 const next=resizeText(initial,'se',50,25,100,50,200,400);
 expect(next.fontSize).toBe(90);expect(next.x*200-100*1.5/2).toBe(50);expect(next.y*400-50*1.5/2).toBe(175);
 expect(resizeText(initial,'se',99999,99999,100,50,200,400).fontSize).toBe(300);
 expect(resizeText(initial,'se',-99999,-99999,100,50,200,400).fontSize).toBe(8);
});
