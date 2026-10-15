/** Deterministic source-space effects shared by preview and export. */
export const LENS_FILM_GLSL = `
uniform vec4 lens;uniform float lensFringing;uniform vec4 film;uniform vec4 filmTone;uniform float filmPixel;
vec2 lensPosition(vec2 p){
  vec2 delta=p-lens.yz;
  vec2 metric=vec2(size.x/size.y,1.0);
  vec2 corner=max(lens.yz,1.0-lens.yz)*metric;
  float radius=dot(delta*metric,delta*metric)/max(0.0001,dot(corner,corner));
  // Overscan fills the rectangle instead of introducing a border or background.
  return lens.yz+delta*(1.0+lens.x*radius)/(1.0+max(0.0,lens.x));
}
vec3 filmOverlay(vec2 p,vec3 rgb){
  if(film.x<=0.0)return rgb;
  vec2 cell=floor(p*size/max(0.25,filmPixel));
  float noise=hash(cell+vec2(frame*13.0,frame*7.0))-.5;
  vec3 treated=rgb+noise*film.y*.22;
  treated+=vec3(.045,.012,-.035)*filmTone.w;
  float pulse=(hash(vec2(frame,71.0))-.5)*filmTone.z*.18;
  treated*=1.0+pulse;
  float edge=smoothstep(.18,.72,length(p-.5));
  treated*=1.0-edge*filmTone.y*.65;
  vec2 dustGrid=vec2(100.0,56.0),tile=floor(p*dustGrid);
  float speck=step(.993,hash(tile+vec2(frame*3.0,frame*11.0)))*(1.0-smoothstep(.0,.23,length(fract(p*dustGrid)-.5)));
  treated=mix(treated,vec3(.92,.86,.73),speck*film.z);
  float scratch=0.0,seed=floor(frame/5.0);
  for(int i=0;i<3;i++){
    float index=float(i),x=hash(vec2(seed,index+40.0));
    float line=1.0-smoothstep(.0,max(.0002,filmPixel/size.x),abs(p.x-x));
    float broken=step(.25,hash(vec2(floor(p.y*22.0),seed+index)));
    scratch+=line*broken*step(.4,hash(vec2(seed+index,99.0)));
  }
  treated+=scratch*film.w*.4;
  return mix(rgb,clamp(treated,0.0,1.0),film.x);
}
`;
