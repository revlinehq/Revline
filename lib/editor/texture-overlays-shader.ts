/** Procedural analog textures. Time is quantized by the composition frame, never wall time. */
export const TEXTURE_OVERLAYS_GLSL = `
uniform float textureTime;uniform vec2 textureOutput;
uniform vec4 vhs;uniform vec2 vhsMotion;
uniform vec4 lightLeak;uniform vec3 lightLeakColor;
float tapeSeed(){return floor(textureTime*30.0*vhsMotion.y+0.0001);}
vec2 tapePosition(vec2 p){
  if(vhs.x<=0.0||vhsMotion.x<=0.0)return p;
  float t=textureTime*vhsMotion.y,seed=tapeSeed();
  float row=floor(p.y*240.0);
  float jitter=(hash(vec2(row,seed))-.5)*.002;
  // A soft rolling tracking band and the short head-switch strip at the foot.
  float center=fract(t*.13+.09);
  float distance=min(abs(p.y-center),1.0-abs(p.y-center));
  float band=exp(-distance*distance/0.0008);
  float head=(1.0-smoothstep(.01,.065,p.y))*(hash(vec2(seed,73.0))-.5);
  p.x+=(jitter+band*sin(p.y*90.0+t*7.0)*.018+head*.035)*vhsMotion.x*vhs.x;
  return p;
}
vec3 tapeOverlay(vec2 p,vec3 rgb){
  if(vhs.x<=0.0)return rgb;
  float seed=tapeSeed();
  // Keep scanlines below the output Nyquist limit in small live previews.
  float lines=min(240.0,textureOutput.y*.4);
  float scan=.5+.5*cos(p.y*lines*6.2831853);
  vec2 cell=floor(p*vec2(min(640.0,textureOutput.x),min(480.0,textureOutput.y)));
  float noise=hash(cell+vec2(seed*17.0,seed*11.0))-.5;
  vec3 treated=rgb*(1.0-scan*vhs.y*.24)+noise*vhs.z*.2;
  return clamp(mix(rgb,treated,vhs.x),0.0,1.0);
}
vec3 lightLeakOverlay(vec2 p,vec3 rgb){
  if(lightLeak.x<=0.0)return rgb;
  float t=textureTime*lightLeak.w,angle=3.14159265-lightLeak.y*6.2831853;
  vec2 normal=vec2(cos(angle),sin(angle)),tangent=vec2(-normal.y,normal.x);
  vec2 center=vec2(.5)+normal*.6+tangent*sin(t*.75)*.1;
  vec2 delta=p-center;
  float width=mix(.13,.65,lightLeak.z);
  vec2 q=vec2(dot(delta,normal)/width,dot(delta,tangent)/(width*1.7));
  float glow=exp(-dot(q,q)*2.0)*(.82+.18*cos(t*1.3));
  // Screen light into the source; no opaque plate and no changes to its alpha.
  return 1.0-(1.0-rgb)*(1.0-lightLeakColor*glow*lightLeak.x);
}
`;
