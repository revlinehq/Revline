import type { FrameDistortion } from './visual-effects';

/** Project a source point after a monotonic radial bend of the entire frame. */
function frameDistortionPoint(x:number,y:number,{horizontal,vertical,skew,bend=0}:FrameDistortion) {
  const curve=1-.15*bend*(x*x+y*y);
  x*=curve;y*=curve;
  const depth=1+.35*horizontal*x+.35*vertical*y;
  return {x:(x+.6*skew*y)/depth,y:y/depth};
}

/** Sample curved edges as well as corners so negative bend and perspective fit. */
export function frameDistortionFit(settings:FrameDistortion) {
  let extent=1;
  for(let step=0;step<=64;step++)for(const side of [-1,1]){
    const along=step/32-1;
    for(const [x,y] of [[side,along],[along,side]]){
      const projected=frameDistortionPoint(x,y,settings);
      extent=Math.max(extent,Math.abs(projected.x),Math.abs(projected.y));
    }
  }
  // Curved extrema can fall between samples; reserve a subpixel safety margin.
  return 1/(extent*((settings.bend??0)===0?1:1.0005));
}

/** Invert the perspective plane, then its radial bend; alpha follows warped edges. */
export const FRAME_DISTORTION_GLSL=`
uniform vec4 perspective;uniform float perspectiveFit;uniform float perspectiveBend;
vec2 perspectivePosition(vec2 p){
  if(perspective.w<.5)return p;
  vec2 q=(p-.5)*2.0/perspectiveFit;
  float a=perspective.x*.35,b=perspective.y*.35,c=perspective.z*.6;
  float depth=1.0-a*q.x+(a*c-b)*q.y;
  if(abs(depth)<.0001)depth=.0001;
  q=vec2(q.x-c*q.y,q.y)/depth;
  float k=perspectiveBend*.15;
  if(abs(k)>.00001){
    float radius=length(q),maximum=1.41421356*(1.0-2.0*k);
    if(radius>maximum+.0001)return vec2(2.0);
    float sourceRadius=radius;
    for(int iteration=0;iteration<8;iteration++){
      float squared=sourceRadius*sourceRadius;
      sourceRadius=clamp(sourceRadius-(sourceRadius*(1.0-k*squared)-radius)/max(.1,1.0-3.0*k*squared),0.0,1.41421356);
    }
    if(radius>.00001)q*=sourceRadius/radius;
  }
  return q*.5+.5;
}
float perspectiveAlpha(vec2 p){
  if(perspective.w<.5)return 1.0;
  vec2 edge=.5/size;
  vec2 inside=smoothstep(-edge,edge,p)*(1.0-smoothstep(1.0-edge,1.0+edge,p));
  return inside.x*inside.y;
}
`;
