import type { FrameDistortion } from './visual-effects';

/** Fit the projected plane without clipping its four corners. */
export function frameDistortionFit({horizontal,vertical,skew}:FrameDistortion) {
  let extent=1;
  for(const x of [-1,1])for(const y of [-1,1]){
    const depth=1+.35*horizontal*x+.35*vertical*y;
    extent=Math.max(extent,Math.abs((x+.6*skew*y)/depth),Math.abs(y/depth));
  }
  return 1/extent;
}

/** Inverse plane projection; straight source edges remain straight. */
export const FRAME_DISTORTION_GLSL=`
uniform vec4 perspective;uniform float perspectiveFit;
vec2 perspectivePosition(vec2 p){
  if(perspective.w<.5)return p;
  vec2 q=(p-.5)*2.0/perspectiveFit;
  float a=perspective.x*.35,b=perspective.y*.35,c=perspective.z*.6;
  float depth=1.0-a*q.x+(a*c-b)*q.y;
  if(abs(depth)<.0001)depth=.0001;
  return vec2(q.x-c*q.y,q.y)/depth*.5+.5;
}
float perspectiveAlpha(vec2 p){
  if(perspective.w<.5)return 1.0;
  vec2 edge=.5/size;
  vec2 inside=smoothstep(-edge,edge,p)*(1.0-smoothstep(1.0-edge,1.0+edge,p));
  return inside.x*inside.y;
}
`;
