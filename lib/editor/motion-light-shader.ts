/** Source-space motion and lighting treatments shared by the live and export kernels. */
export const MOTION_LIGHT_GLSL = `
uniform vec3 directional;uniform vec3 turbulence;
uniform vec4 sweep;uniform vec2 sweepMotion;uniform vec3 sweepColor;
vec2 turbulentPosition(vec2 p){
  if(turbulence.x<=0.0)return p;
  vec2 point=p*size/max(1.0,turbulence.y);
  float t=textureTime*turbulence.z;
  // Continuous, bounded multi-frequency flow: no per-frame random geometry.
  vec2 flow=vec2(
    sin(point.y*1.7+t*.7)+.5*sin(point.x*2.3+point.y*.9-t*.5),
    cos(point.x*1.5-t*.6)+.5*sin(point.y*2.1-point.x*.8+t*.4)
  )/1.5;
  return p+flow*turbulence.x/size;
}
vec4 directionalSample(vec2 p){
  vec4 sum=vec4(0.0);float total=0.0;
  for(int i=0;i<21;i++){
    float t=(float(i)-10.0)/10.0,weight=exp(-t*t*2.5);
    sum+=sampleSource(p+directional.yz*t*directional.x/size)*weight;total+=weight;
  }
  return sum/total;
}
vec3 lightSweepOverlay(vec2 p,vec3 rgb){
  if(sweep.x<=0.0)return rgb;
  vec2 axis=vec2(cos(sweep.y),-sin(sweep.y));
  float extent=.5*(abs(axis.x)+abs(axis.y));
  float position=sweep.z;
  if(sweepMotion.x>0.0)position=fract(position+textureTime*sweepMotion.x*.25);
  // The beam starts and ends outside the picture, so looping does not flash a cut.
  float center=mix(-extent-sweep.w,extent+sweep.w,position);
  float d=(dot(p-.5,axis)-center)/max(.01,sweep.w);
  float light=exp(-d*d*5.0)*sweep.x;
  return 1.0-(1.0-rgb)*(1.0-sweepColor*light);
}
`;
