import { expect, test } from 'vitest';
import { frameDistortionFit, frameDistortionPoint } from './frame-distortion';
import { DEFAULT_FRAME_DISTORTION } from './visual-effects';

test('bend curves complete frame edges while zero and old missing bend preserve a flat plane',()=>{
  const neutral={...DEFAULT_FRAME_DISTORTION,bend:0};
  expect(frameDistortionPoint(1,.5,neutral)).toEqual({x:1,y:.5});
  const legacy={enabled:true,horizontal:.2,vertical:-.1,skew:.3};
  expect(frameDistortionPoint(1,.5,legacy)).toEqual(frameDistortionPoint(1,.5,{...legacy,bend:0}));
  const convex={...neutral,bend:1},concave={...neutral,bend:-1};
  expect(frameDistortionPoint(1,0,convex).x).toBeGreaterThan(frameDistortionPoint(1,1,convex).x);
  expect(frameDistortionPoint(1,0,concave).x).toBeLessThan(frameDistortionPoint(1,1,concave).x);
});

test('curved edges remain inside the fitted frame across bend and extreme advanced controls',()=>{
  for(const bend of [-1,-.35,0,.35,1])for(const horizontal of [-1,0,1])for(const vertical of [-1,0,1])for(const skew of [-1,0,1]){
    const settings={enabled:true,bend,horizontal,vertical,skew},fit=frameDistortionFit(settings);
    expect(fit).toBeGreaterThan(0);expect(fit).toBeLessThanOrEqual(1);
    for(let step=0;step<=256;step++)for(const side of [-1,1])for(const [x,y]of[[side,step/128-1],[step/128-1,side]]){
      const point=frameDistortionPoint(x,y,settings);
      expect(Math.abs(point.x*fit)).toBeLessThanOrEqual(1.0001);expect(Math.abs(point.y*fit)).toBeLessThanOrEqual(1.0001);
    }
  }
});
