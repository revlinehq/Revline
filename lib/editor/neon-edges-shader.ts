/** Shared preview/export fragment helpers; sampling stays entirely on the GPU. */
export const NEON_EDGES_GLSL = `
uniform vec4 neon;uniform vec3 neonColor;uniform float neonPixel;
float neonLuma(vec2 p){return dot(sampleSource(p).rgb,vec3(0.2126,0.7152,0.0722));}
float neonGradient(vec2 p,vec2 stepSize){
  float tl=neonLuma(p+stepSize*vec2(-1.0,1.0)),t=neonLuma(p+stepSize*vec2(0.0,1.0)),tr=neonLuma(p+stepSize);
  float l=neonLuma(p+stepSize*vec2(-1.0,0.0)),r=neonLuma(p+stepSize*vec2(1.0,0.0));
  float bl=neonLuma(p-stepSize),b=neonLuma(p+stepSize*vec2(0.0,-1.0)),br=neonLuma(p+stepSize*vec2(1.0,-1.0));
  return clamp(length(vec2(tr+2.0*r+br-tl-2.0*l-bl,tl+2.0*t+tr-bl-2.0*b-br))/4.0,0.0,1.0);
}
vec3 neonEdges(vec2 p,vec3 rgb){
  if(neon.x<=0.0)return rgb;
  vec2 edgeStep=vec2(neonPixel)/size*mix(4.0,1.0,neon.y);
  float threshold=neon.z*0.9;
  float core=smoothstep(threshold,threshold+0.08,neonGradient(p,edgeStep));
  float halo=0.0;
  if(neon.w>0.0)halo=smoothstep(threshold,threshold+0.08,neonGradient(p,edgeStep*(1.0+neon.w*5.0)))*neon.w*0.65;
  vec3 luminous=rgb*0.08+neonColor*(core*1.2+halo)+vec3(core*0.25);
  return mix(rgb,clamp(luminous,0.0,1.0),neon.x);
}
`;
