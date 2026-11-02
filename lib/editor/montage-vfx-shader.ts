/** Shared GLSL for preview and export. Atlas quadrants are clamped away from tile seams. */
export const PARALLAX_GLSL = `
uniform vec4 parallax;uniform vec4 parallaxCamera;
vec4 atlas(vec2 p,vec2 tile){vec2 halfPixel=1.0/size;return texture2D(source,(clamp(p,halfPixel,1.0-halfPixel)+tile)*.5);}
vec2 parallaxPlane(vec2 p,float depth){
  vec2 q=(p-.5)/parallaxCamera.z;
  float angle=parallaxCamera.w*parallax.w*.0174533;
  q=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*q;
  q/=max(.8,1.0+q.x*angle*.35+q.y*angle*.2);
  return q+.5-parallax.yz*parallax.w*depth;
}
vec4 sampleSource(vec2 p){
  if(parallax.x<.5)return texture2D(source,clamp(p,vec2(0.0),vec2(1.0)));
  vec2 bg=parallaxPlane(p,.18);
  for(int i=0;i<3;i++){float d=atlas(bg,vec2(1.0,0.0)).r;bg=parallaxPlane(p,.12+d*.35);}
  vec4 back=atlas(bg,vec2(0.0,1.0));
  vec2 fg=parallaxPlane(p,.9);
  float inside=step(0.0,fg.x)*step(fg.x,1.0)*step(0.0,fg.y)*step(fg.y,1.0);
  float mask=atlas(fg,vec2(0.0,0.0)).r*inside;
  return vec4(mix(back.rgb,atlas(fg,vec2(1.0,1.0)).rgb,mask),1.0);
}`;
export const IMPACT_GLSL = `
uniform vec4 impact;uniform vec4 impactDetail;uniform vec2 impactCenter;
vec3 impactLook(vec2 p,vec3 rgb){
  if(impact.x<.5)return rgb;
  float l=dot(rgb,vec3(.2126,.7152,.0722)),threshold=impact.z;
  vec3 look=1.0-rgb;
  if(impact.x>1.5&&impact.x<2.5)look=vec3(step(threshold,l));
  if(impact.x>2.5&&impact.x<3.5)look=floor(clamp(rgb,0.0,1.0)*(impact.w-1.0)+.5)/(impact.w-1.0);
  if(impact.x>3.5){
    vec2 px=2.0/size;
    float dx=dot(sampleSource(p+vec2(px.x,0.0)).rgb-sampleSource(p-vec2(px.x,0.0)).rgb,vec3(.2126,.7152,.0722));
    float dy=dot(sampleSource(p+vec2(0.0,px.y)).rgb-sampleSource(p-vec2(0.0,px.y)).rgb,vec3(.2126,.7152,.0722));
    float ink=smoothstep(.08,.22,length(vec2(dx,dy)));
    float tone=floor(clamp((l-threshold)*1.5+.5,0.0,1.0)*(impact.w-1.0)+.5)/(impact.w-1.0);
    look=vec3(tone*(1.0-ink));
  }
  vec2 ray=(uv-impactCenter)*vec2(size.x/size.y,1.0);
  float angle=atan(ray.y,ray.x),radius=length(ray);
  float lines=step(.89,sin(angle*173.0+sin(angle*47.0)*3.0))*smoothstep(.16,.7,radius)*impactDetail.x;
  look=mix(look,vec3(0.0),lines);
  look=mix(look,vec3(1.0),impactDetail.y);
  return mix(rgb,look,impact.y);
}`;
