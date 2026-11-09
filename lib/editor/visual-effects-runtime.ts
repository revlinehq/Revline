import { PARALLAX_GLSL, IMPACT_GLSL } from './montage-vfx-shader';
import { IMPACT_PRESETS, DEFAULT_IMPACT, type ImpactSettings, type ParallaxSettings } from './montage-vfx';
import { cameraGlideBlurAt, motionZoomBlurAt, type CameraGlideBlurSource } from './camera-motion-blur';
import type { VisualEffects } from './visual-effects';
import { trackOf, type AudioReactive, type Clip, type EffectKeyframeLane } from './types';
import { adjustmentFrame } from './adjustment-layers';
import { FRAME_DISTORTION_GLSL, frameDistortionFit } from './frame-distortion';
import { LENS_FILM_GLSL } from './lens-film-shader';
import { NEON_EDGES_GLSL } from './neon-edges-shader';
import { DEFAULT_NEON_EDGES } from './neon-edges';
import { TEXTURE_OVERLAYS_GLSL } from './texture-overlays-shader';
import { MOTION_LIGHT_GLSL } from './motion-light-shader';
import { effectsAt } from './effect-keyframes';
export { installAdjustmentLayers } from './adjustment-layers';
export { installSolidColorLayers } from './solid-color-layers';
export { installClipMasks } from './masks';
export { installPixelTracking } from './pixel-tracking-runtime';
export { installAudioReactive } from './audio-reactive';
import { decodeLevels, hasReactiveEffects, reactiveEffectsAt } from './audio-reactive';
import { HSL_CENTERS, curvesTexture, customAtlas, hslUniform, lookAtlas, type ColorFinishSource } from './color-finish';
export { installVisualFades } from './visual-fades-runtime';

type RenderEffects = VisualEffects & { impact?: ImpactSettings; parallax?: ParallaxSettings };
export type VisualEffectInput = RenderEffects & { cameraGlideBlur?:CameraGlideBlurSource; effectKeyframes?:EffectKeyframeLane[]; motionOffset?:number; audioReactive?:AudioReactive; colorFinish?:ColorFinishSource };
export type VisualEffectSource = VisualEffectInput & { id: string };
export type VisualEffectsController = { set(id: string, effects: VisualEffectInput): void; setTimedEffects(clips:Clip[]):void; redraw(): void; dispose(): void };

/**
 * One 5x5 Gaussian pass leaves gaps between its taps once they spread past a few pixels, which
 * prints a dot grid on large blurs. Larger amounts run as successive passes whose spacing never
 * outgrows the blur already applied, with the same total variance as the single pass they replace.
 */
const SOFT_BLUR_FIRST_STEP = 4;
function softBlurSteps(amount: number) {
  const steps: number[] = [];
  let variance = 0;
  while (amount * amount - variance > 1e-6) {
    const step = Math.min(Math.sqrt(amount * amount - variance), steps.length ? 2 * Math.sqrt(variance) : SOFT_BLUR_FIRST_STEP);
    steps.push(step); variance += step * step;
  }
  return steps;
}

/** One browser bundle runs the same kernel in preview and exported compositions. */
export function installVisualEffects(sources: VisualEffectSource[], fps: number, resolution: number) {
  type Clock = { time(): number; render: (...args: unknown[]) => unknown; eventCallback?(name:string,callback?:(()=>void)|null):unknown;paused?(value?:boolean):boolean|Clock };
  type RuntimeWindow = Window & { __timelines: { revline: Clock & { __hfReal?: Clock } }; __revlineEffects?: VisualEffectsController; __hf?: { colorGrading?: { redraw?: () => void } } };
  const host = window as unknown as RuntimeWindow;
  const preview = !!document.querySelector('meta[name="hyperframes-studio-preview"]');
  const clock = host.__timelines.revline.__hfReal ?? host.__timelines.revline;
  type Entry = { source: HTMLVideoElement | HTMLImageElement; effects: VisualEffectInput; levels?: Uint8Array; finishKey?: string; curvesTexture?: WebGLTexture; lutTexture?: WebGLTexture; lutSize?: number; nativeCorners?: { node:HTMLElement; originalRadius:string }; neonColor?: number; canvas?: HTMLCanvasElement; gl?: WebGLRenderingContext; program?: WebGLProgram; impactProgram?: WebGLProgram; impactUniforms?: Record<string, WebGLUniformLocation | null>; parallaxProgram?: WebGLProgram; parallaxUniforms?: Record<string, WebGLUniformLocation | null>; gradeOnly?: boolean; texture?: WebGLTexture; buffer?: WebGLBuffer; uniforms?: Record<string, WebGLUniformLocation | null>; passTextures?: WebGLTexture[]; framebuffer?: WebGLFramebuffer; passWidth?: number; passHeight?: number; nominalWidth?: number; nominalHeight?: number; detailWidth?: number; detailHeight?: number; lastPassKey?: string; lastPassCount?: number; lastFrame?: number; lastSource?: string | number; lastTransform?: string; dirty: boolean; injected?: HTMLImageElement; failed?: boolean; videoCallback?: number; listened?: HTMLVideoElement; mirror?: HTMLVideoElement; decodedFrame?: number; decodedListener?: () => void; uploadCanvas?: HTMLCanvasElement };
  type Resources = Pick<Entry, 'canvas' | 'gl' | 'program' | 'texture' | 'buffer' | 'uniforms' | 'passTextures' | 'framebuffer' | 'passWidth' | 'passHeight' | 'curvesTexture' | 'lutTexture' | 'parallaxProgram' | 'parallaxUniforms' | 'impactProgram' | 'impactUniforms'>;
  const entries = new Map<string, Entry>();
  const available: Resources[] = [];
  // A preview cut swaps a whole effect stack at once (mirror blur: four blurred layers). Spare
  // contexts wait for the next cut instead of being lost and recompiled, under Chrome's 16
  // live WebGL contexts per page.
  const SPARE_CONTEXTS = 4, CONTEXT_BUDGET = 12, PREPARE_AHEAD_SECONDS = 1.5;
  const liveContexts = () => { let count = available.length; for (const entry of entries.values()) if (entry.gl) count++; return count; };
  // The nearest clip start after the playhead, computed once per clock time rather than per entry.
  let nearest = { time: NaN, start: Infinity };
  function nearestStart(time: number) {
    if (nearest.time === time) return nearest.start;
    let start = Infinity;
    for (const entry of entries.values()) { const value = Number(entry.source.dataset.start); if (value > time + 1e-6 && value < start) start = value; }
    nearest = { time, start };
    return start;
  }
  /** The decoder an entry draws: its own video, or in preview the sharp clip a mirror-blur copy repeats. */
  function videoOf(entry: Entry): HTMLVideoElement | undefined {
    const twin = preview ? entry.source.dataset.revlineMirrorOf : undefined;
    if (!twin) return entry.source instanceof HTMLVideoElement ? entry.source : undefined;
    if (!entry.mirror?.isConnected || entry.mirror.dataset.sourceClip !== twin) entry.mirror = document.querySelector<HTMLVideoElement>(`video[data-source-clip="${CSS.escape(twin)}"]`) ?? undefined;
    return entry.mirror;
  }
  /** A clip starting shortly is drawn while still hidden, from its warmed decoder waiting at the clip's first frame. */
  function preparing(entry: Entry, time: number) {
    if (!preview || entry.source.hasAttribute('data-revline-transition-visible')) return false;
    const start = Number(entry.source.dataset.start);
    // Only the nearest cut: its stack takes the contexts the outgoing stack returns to the pool.
    if (!(time < start - 1e-6 && start - time <= PREPARE_AHEAD_SECONDS) || start > nearestStart(time) + 1e-6) return false;
    return !!videoOf(entry);
  }
  let disposed = false;
  const baseEffects=new Map<string,VisualEffectInput>();
  const defaultNeonColor=Number.parseInt(DEFAULT_NEON_EDGES.color.slice(1),16);
  let timedEffects:Clip[]=[];
  function effectPasses(base:VisualEffectInput,time:number):RenderEffects[] {
    const {softBlur,directionalBlur,frameCorners,parallax,...other}=base;
    const passes:RenderEffects[]=[];
    if(parallax)passes.push({parallax});
    // Blur has its own pass so combining it with radial blur never multiplies sample counts.
    if(softBlur?.enabled&&softBlur.amount>0)for(const amount of softBlurSteps(softBlur.amount))passes.push({softBlur:{...softBlur,amount}});
    if(directionalBlur?.enabled&&directionalBlur.amount>0)passes.push({directionalBlur});
    const composition=base.cameraGlideBlur?document.getElementById('composition'):null;
    const cameraBlur=!base.cameraGlideBlur||preview&&clock.paused?.()===true?undefined:cameraGlideBlurAt(base.cameraGlideBlur,time,Number(composition?.dataset.width)*1080/resolution,Number(composition?.dataset.height)*1080/resolution);
    if(cameraBlur)passes.push({directionalBlur:cameraBlur});
    const scaleBlur=!base.cameraGlideBlur||preview&&clock.paused?.()===true?undefined:motionZoomBlurAt(base.cameraGlideBlur,time);
    if(scaleBlur)passes.push({zoomBlur:scaleBlur});
    if(enabled(other)||other.colorFinish)passes.push(other);
    for(const clip of timedEffects){
      if(time<clip.start-1e-6||time>=clip.start+clip.duration-1e-6)continue;
      if(clip.effectPreset==='impact-frame'){passes.push({impact:clip.impact??DEFAULT_IMPACT});continue;}
      if(!clip.zoomBlur?.enabled)continue;
      const amount=clip.zoomBlur.amount*adjustmentFrame(clip,time).opacity;
      if(amount>0)passes.push({zoomBlur:{...clip.zoomBlur,amount}});
    }
    // Round the visible clip window last, independently of distortion and blur.
    if(frameCorners?.enabled&&frameCorners.amount>0)passes.push({frameCorners});
    return passes;
  }
  const vertex = `attribute vec2 position;varying vec2 uv;void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.0,1.0);}`;
  const impactFragment = `precision highp float;varying vec2 uv;uniform sampler2D source;uniform vec2 size;vec4 sampleSource(vec2 p){return texture2D(source,clamp(p,vec2(0.0),vec2(1.0)));}${IMPACT_GLSL}void main(){vec4 c=sampleSource(uv);gl_FragColor=vec4(impactLook(uv,c.rgb),c.a);}`;
  const parallaxFragment = `precision highp float;varying vec2 uv;uniform sampler2D source;uniform vec2 size;${PARALLAX_GLSL}void main(){gl_FragColor=sampleSource(uv);}`;
  const grade = `vec3 rgb=c.rgb*exp2(grade.x);
  rgb*=vec3(1.0+balance.x*0.18+balance.y*0.08,1.0-balance.y*0.16,1.0-balance.x*0.18+balance.y*0.08);
  rgb=(rgb-0.5)*grade.y+0.5;
  float luma=dot(rgb,vec3(0.2126,0.7152,0.0722));
  float chroma=max(rgb.r,max(rgb.g,rgb.b))-min(rgb.r,min(rgb.g,rgb.b));
  float saturation=grade.z*(1.0+balance.z*(1.0-clamp(chroma,0.0,1.0)));
  rgb=clamp(mix(vec3(luma),rgb,saturation),0.0,1.0);`;
  // Software export GPUs otherwise compile and run every optional spatial FX
  // branch for a simple grade. Keep the same grade math, pixels and alpha.
  const gradeFragment = `precision highp float;varying vec2 uv;uniform sampler2D source;uniform vec4 grade;uniform vec3 balance;uniform vec4 lens;
void main(){vec2 p=lens.yz+(uv-lens.yz);vec4 c=texture2D(source,clamp(p,vec2(0.0),vec2(1.0)));${grade}gl_FragColor=vec4(rgb,c.a);}`;
  const fragment = `precision highp float;
varying vec2 uv;uniform sampler2D source;uniform vec2 size;uniform float frame;
uniform sampler2D curves;uniform float curvesOn;uniform vec3 hslBands[8];uniform vec2 hslSpan[8];uniform float hslCenter[8];uniform float hslOn;uniform sampler2D lut;uniform vec2 lutInfo;uniform vec4 bloom;
uniform float softBlur;uniform float frameCorners;uniform vec4 cornerWindow;uniform float invert;uniform vec4 grade;uniform vec3 balance;uniform vec3 zoom;uniform vec3 glitch;uniform vec3 dither;uniform float ditherPalette;uniform vec3 ditherShadow;uniform vec3 ditherHighlight;
float bayer2(vec2 p){return p.y<1.0?(p.x<1.0?0.0:2.0):(p.x<1.0?3.0:1.0);}
float bayer4(vec2 p){p=mod(floor(p),4.0);return (4.0*bayer2(mod(p,2.0))+bayer2(floor(p/2.0))+0.5)/16.0;}
float hash(vec2 p){float n=mod(p.x*73.0+p.y*151.0+19.0,251.0);n=mod(n*n*17.0+n*13.0,65521.0);return mod(n*37.0,1021.0)/1021.0;}
vec4 sampleSource(vec2 p){return texture2D(source,clamp(p,vec2(0.0),vec2(1.0)));}
vec3 rgb2hsl(vec3 c){float mx=max(max(c.r,c.g),c.b),mn=min(min(c.r,c.g),c.b),l=(mx+mn)*.5,d=mx-mn,h=0.0,s=0.0;
  if(d>1e-5){s=l>.5?d/(2.0-mx-mn):d/(mx+mn);if(mx==c.r)h=(c.g-c.b)/d+(c.g<c.b?6.0:0.0);else if(mx==c.g)h=(c.b-c.r)/d+2.0;else h=(c.r-c.g)/d+4.0;h/=6.0;}
  return vec3(h,s,l);}
float hue2rgb(float p,float q,float t){t=fract(t);if(t<1.0/6.0)return p+(q-p)*6.0*t;if(t<.5)return q;if(t<2.0/3.0)return p+(q-p)*(2.0/3.0-t)*6.0;return p;}
vec3 hsl2rgb(vec3 h){if(h.y<=0.0)return vec3(h.z);float q=h.z<.5?h.z*(1.0+h.y):h.z+h.y-h.z*h.y,p=2.0*h.z-q;return vec3(hue2rgb(p,q,h.x+1.0/3.0),hue2rgb(p,q,h.x),hue2rgb(p,q,h.x-1.0/3.0));}
vec3 hslAdjust(vec3 rgb){
  vec3 h=rgb2hsl(clamp(rgb,0.0,1.0));vec3 shift=vec3(0.0);
  for(int i=0;i<8;i++){
    float d=h.x*360.0-hslCenter[i];d=d-360.0*floor((d+180.0)/360.0);
    float w=d<0.0?max(0.0,1.0+d/hslSpan[i].x):max(0.0,1.0-d/hslSpan[i].y);
    shift+=hslBands[i]*w;
  }
  // Grays carry no hue: fade the adjustment in with saturation.
  float k=smoothstep(0.02,0.2,h.y);
  h.x=fract(h.x+shift.x*k);h.y=clamp(h.y*(1.0+shift.y*k),0.0,1.0);h.z=clamp(h.z+shift.z*k*.35*(1.0-abs(2.0*h.z-1.0)+.2),0.0,1.0);
  return hsl2rgb(h);}
vec3 applyLut(vec3 c){
  float n=lutInfo.x,b=c.b*(n-1.0),b0=floor(b),b1=min(b0+1.0,n-1.0),f=b-b0;
  float x=c.r*(n-1.0)+.5,y=(c.g*(n-1.0)+.5)/n;
  return mix(texture2D(lut,vec2((b0*n+x)/(n*n),y)).rgb,texture2D(lut,vec2((b1*n+x)/(n*n),y)).rgb,f);}
vec3 bloomGlow(vec2 p){
  vec3 sum=vec3(0.0);
  for(int i=0;i<24;i++){
    float a=float(i)*2.39996,r=sqrt((float(i)+.5)/24.0)*bloom.z;
    vec3 s=sampleSource(p+vec2(cos(a),sin(a))*r/size).rgb;
    float l=dot(s,vec3(.2126,.7152,.0722));sum+=s*max(l-bloom.y,0.0)/max(1.0-bloom.y,.05);
  }
  return sum/24.0;}
${NEON_EDGES_GLSL}
${LENS_FILM_GLSL}
${TEXTURE_OVERLAYS_GLSL}
${MOTION_LIGHT_GLSL}
${FRAME_DISTORTION_GLSL}
float cornerAlpha(vec2 p){
  if(frameCorners<=0.0)return 1.0;
  vec2 bounds=size*cornerWindow.zw;
  vec2 point=((p-cornerWindow.xy)/cornerWindow.zw-.5)*bounds;
  float radius=frameCorners*min(bounds.x,bounds.y)*.5;
  vec2 edge=abs(point)-bounds*.5+radius;
  float distance=length(max(edge,0.0))+min(max(edge.x,edge.y),0.0)-radius;
  return 1.0-smoothstep(-.75,.75,distance);
}
vec3 orderedColor(vec3 rgb,float steps,float threshold){
  if(ditherPalette>0.5){
    float tone=clamp(floor(dot(rgb,vec3(0.2126,0.7152,0.0722))*steps+threshold)/steps,0.0,1.0);
    return mix(ditherShadow,ditherHighlight,tone);
  }
  return clamp(floor(rgb*steps+threshold)/steps,0.0,1.0);
}
vec4 radial(vec2 p){
  if(zoom.x<=0.0)return sampleSource(p);
  vec4 sum=vec4(0.0);float weight=0.0;
  for(int i=0;i<20;i++){float t=float(i)/19.0;float w=1.0-abs(t*2.0-1.0)*0.5;sum+=sampleSource(p+(zoom.yz-p)*t*zoom.x*0.6)*w;weight+=w;}
  return sum/weight;
}
void main(){
  vec2 plane=perspectivePosition(uv),p=tapePosition(turbulentPosition(lensPosition(plane)));float split=0.0;
  if(glitch.x>0.0){
    float band=floor((1.0-p.y)*size.y/max(1.0,glitch.y));
    float seed=floor(frame/2.0);float gate=step(1.0-glitch.x*0.8,hash(vec2(band,seed)));
    p.x+=(hash(vec2(band+19.0,seed))-0.5)*0.24*glitch.x*gate;
    split=glitch.z/size.x*glitch.x;
  }
  vec4 c=radial(p);
  if(directional.x>0.0)c=directionalSample(p);
  if(softBlur>0.0){
    c=vec4(0.0);
    for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
      float wx=x==0?6.0:(abs(float(x))==1.0?4.0:1.0),wy=y==0?6.0:(abs(float(y))==1.0?4.0:1.0);
      c+=sampleSource(p+vec2(float(x),float(y))*softBlur*.5/size)*(wx*wy/256.0);
    }
  }
  if(split>0.0){c.r=radial(p+vec2(split,0.0)).r;c.b=radial(p-vec2(split,0.0)).b;}
  if(vhs.x>0.0&&vhs.w>0.0){
    vec2 bleed=vec2(vhs.w*vhs.x*.009,0.0);
    c.r=mix(c.r,radial(p-bleed).r,.75);c.b=mix(c.b,radial(p+bleed).b,.75);
  }
  if(lensFringing>0.0){vec2 fringe=(uv-lens.yz)*lensFringing/size;c.r=radial(p+fringe).r;c.b=radial(p-fringe).b;}
  if(bloom.x>0.0)c.rgb+=bloomGlow(p)*bloom.x*1.6;
  // Exposure in stops, then warm/cool and green/magenta balance.
  ${grade}
  if(curvesOn>0.5){rgb=clamp(rgb,0.0,1.0)*(255.0/256.0)+.5/256.0;rgb=vec3(texture2D(curves,vec2(rgb.r,.5)).r,texture2D(curves,vec2(rgb.g,.5)).g,texture2D(curves,vec2(rgb.b,.5)).b);rgb=rgb*(255.0/256.0)+.5/256.0;rgb=vec3(texture2D(curves,vec2(rgb.r,.5)).a,texture2D(curves,vec2(rgb.g,.5)).a,texture2D(curves,vec2(rgb.b,.5)).a);}
  if(hslOn>0.5)rgb=hslAdjust(rgb);
  if(lutInfo.y>0.0)rgb=mix(rgb,applyLut(clamp(rgb,0.0,1.0)),lutInfo.y);
  rgb=mix(rgb,1.0-rgb,invert);
  rgb=neonEdges(p,rgb);
  if(dither.x>0.0){
    float steps=dither.y-1.0;
    float cell=max(0.01,dither.z);vec3 ordered;
    if(cell>=1.0){ordered=orderedColor(rgb,steps,bayer4(gl_FragCoord.xy/cell));}
    else if(cell<=0.25){
      // A pixel spans a complete Bayer tile: use its average quantized tone.
      ordered=clamp(floor(rgb*steps*16.0+0.5)/(steps*16.0),0.0,1.0);
      if(ditherPalette>0.5){float tone=clamp(floor(dot(rgb,vec3(0.2126,0.7152,0.0722))*steps*16.0+0.5)/(steps*16.0),0.0,1.0);ordered=mix(ditherShadow,ditherHighlight,tone);}
    }else{
      // Filter cells smaller than a display pixel instead of point-sampling a
      // repeating subset of the matrix, which can turn middle gray solid black.
      ordered=vec3(0.0);
      for(int y=0;y<4;y++)for(int x=0;x<4;x++){
        vec2 offset=(vec2(float(x),float(y))+0.5)/4.0-0.5;
        ordered+=orderedColor(rgb,steps,bayer4((gl_FragCoord.xy+offset)/cell))/16.0;
      }
    }
    rgb=mix(rgb,ordered,dither.x);
  }
  rgb=filmOverlay(uv,rgb);
  rgb=tapeOverlay(uv,rgb);
  rgb=lightLeakOverlay(uv,rgb);
  rgb=lightSweepOverlay(uv,rgb);
  gl_FragColor=vec4(rgb,c.a*perspectiveAlpha(plane)*cornerAlpha(uv));
}`;

  function enabled(effects: VisualEffects) {
    const c = effects.colorGrade, z = effects.zoomBlur, g = effects.glitch;
    return !!(effects.bloom?.enabled && effects.bloom.amount > 0 || c?.enabled && (c.exposure || c.contrast !== 1 || c.saturation !== 1 || c.temperature || c.tint || c.vibrance) || z?.enabled && z.amount > 0 || g?.enabled && g.intensity > 0 || effects.invert?.enabled && effects.invert.amount > 0 || effects.dither?.enabled && effects.dither.amount > 0 || effects.neonEdges?.enabled && effects.neonEdges.amount > 0 || effects.lensDistortion?.enabled && (effects.lensDistortion.amount !== 0 || effects.lensDistortion.fringing > 0) || effects.filmOverlay?.enabled && effects.filmOverlay.amount > 0 || effects.vhs?.enabled && effects.vhs.amount > 0 || effects.lightLeak?.enabled && effects.lightLeak.amount > 0 || effects.directionalBlur?.enabled && effects.directionalBlur.amount > 0 || effects.turbulentDisplace?.enabled && effects.turbulentDisplace.amount > 0 || effects.lightSweep?.enabled && effects.lightSweep.amount > 0 || effects.softBlur?.enabled && effects.softBlur.amount > 0 || effects.frameCorners?.enabled && effects.frameCorners.amount>0 || effects.frameDistortion?.enabled && (effects.frameDistortion.horizontal !== 0 || effects.frameDistortion.vertical !== 0 || effects.frameDistortion.skew !== 0 || (effects.frameDistortion.bend??0)!==0));
  }
  function clearNativeCorners(entry:Entry) {
    if(!entry.nativeCorners)return;
    entry.nativeCorners.node.style.borderRadius=entry.nativeCorners.originalRadius;
    entry.nativeCorners=undefined;
  }
  function nativeCorners(entry:Entry,passes:VisualEffects[]) {
    const corners=passes.length===1?passes[0].frameCorners:undefined,node=entry.source.parentElement;
    if(!corners?.enabled||corners.amount<=0||enabled({...passes[0],frameCorners:undefined})||!node?.classList.contains('source-window')||entry.source.hasAttribute('data-revline-transition-visible')||entry.source.hasAttribute('data-revline-transition-hold')) {
      clearNativeCorners(entry);return false;
    }
    // The crop window already clips its native media. A radius alone needs no
    // per-frame video upload/readback or effect canvas, including injected
    // export frames. CSS carries the same window radius through crop/motion/scale.
    if(entry.canvas)release(entry);
    if(entry.nativeCorners?.node!==node){clearNativeCorners(entry);entry.nativeCorners={node,originalRadius:node.style.borderRadius};}
    const width=node.style.width.endsWith('px')?parseFloat(node.style.width):node.clientWidth;
    const height=node.style.height.endsWith('px')?parseFloat(node.style.height):node.clientHeight;
    const radius=`${corners.amount*Math.min(width,height)*.5}px`;
    if(node.style.borderRadius!==radius)node.style.borderRadius=radius;
    return true;
  }
  function release(entry: Entry) {
    entry.source.removeAttribute('data-revline-effects');
    entry.injected?.removeAttribute('data-revline-effects');
    entry.canvas?.remove();
    if (preview && !disposed && !entry.failed && entry.canvas && entry.gl && !entry.gl.isContextLost()) {
      const { canvas, gl, program, texture, buffer, uniforms, passTextures, framebuffer, passWidth, passHeight, curvesTexture, lutTexture, parallaxProgram, parallaxUniforms, impactProgram, impactUniforms } = entry;
      available.push({ canvas, gl, program, texture, buffer, uniforms, passTextures, framebuffer, passWidth, passHeight, curvesTexture, lutTexture, parallaxProgram, parallaxUniforms, impactProgram, impactUniforms });
      if (available.length > SPARE_CONTEXTS) destroy(available.shift()!);
      else if (liveContexts() - 1 > CONTEXT_BUDGET) destroy(available.pop()!);
    } else destroy(entry);
    entry.impactProgram = undefined; entry.impactUniforms = undefined; entry.parallaxProgram = undefined; entry.parallaxUniforms = undefined; entry.gl = undefined; entry.canvas = undefined; entry.program = undefined; entry.uploadCanvas = undefined; entry.passTextures = undefined; entry.framebuffer = undefined; entry.passWidth = undefined; entry.passHeight = undefined; entry.lastSource = undefined; entry.lastFrame = undefined; entry.curvesTexture = undefined; entry.lutTexture = undefined; entry.finishKey = undefined;
  }
  function destroy(resources: Resources) {
    const gl = resources.gl; if (!gl) return;
    gl.deleteTexture(resources.texture ?? null); gl.deleteBuffer(resources.buffer ?? null); gl.deleteProgram(resources.program ?? null); gl.deleteProgram(resources.parallaxProgram ?? null); gl.deleteProgram(resources.impactProgram ?? null);
    for(const texture of [...resources.passTextures??[],resources.curvesTexture,resources.lutTexture])if(texture)gl.deleteTexture(texture);
    gl.deleteFramebuffer(resources.framebuffer??null);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  function report(error: unknown) {
    const message = error instanceof Error ? error.message : 'Visual effects could not render.';
    document.documentElement.dataset.visualEffectsError = message;
    console.error('Revline visual effects:', message);
    window.dispatchEvent(new CustomEvent('revline-effects-error', { detail: message }));
  }
  function sizeOutput(entry:Entry,passes:VisualEffects[]) {
    // Keep preview pixel work bounded when each FX layer adds a shader pass.
    // Export retains full composition density; block sizes remain screen-scaled.
    // A grade is a single point-color pass. Preserve its source/project detail
    // rather than magnifying the Fit-sized bitmap when the user zooms in.
    const colorOnly=preview&&passes.length===1&&passes[0].colorGrade?.enabled&&!enabled({...passes[0],colorGrade:undefined});
    const budget=preview?Math.sqrt(passes.length):1,canvas=entry.canvas!;
    const width=colorOnly?entry.detailWidth!:Math.max(1,Math.round(entry.nominalWidth!/budget));
    const height=colorOnly?entry.detailHeight!:Math.max(1,Math.round(entry.nominalHeight!/budget));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;entry.lastSource=undefined;}
  }
  function makeProgram(gl:WebGLRenderingContext,code:string){
    const compile = (type: number, sourceCode: string) => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, sourceCode); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`Visual effect shader failed: ${log}`); }
      return shader;
    };
    const program = gl.createProgram()!, vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, code);
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.bindAttribLocation(program,0,'position'); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Visual effect shader could not link.');
    return program;
  }
  function initialize(entry: Entry, width: number, height: number, passes:VisualEffects[], gradeOnly:boolean) {
    let reusable = preview ? available.pop() : undefined;
    while(reusable?.gl?.isContextLost()){destroy(reusable);reusable=available.pop();}
    const canvas = reusable?.canvas ?? document.createElement('canvas');
    canvas.className = 'visual-effect-output'; canvas.dataset.effectSource = entry.source.id;
    // Match the composition's pixel density while avoiding oversized source canvases.
    const displayWidth = entry.source.style.width.endsWith('px') ? parseFloat(entry.source.style.width) : width;
    const displayHeight = displayWidth * height / width;
    // The player keeps a full-resolution iframe and scales it with CSS. Its
    // innerWidth is therefore the composition width, not the visible preview.
    const viewport = window.frameElement?.getBoundingClientRect();
    const previewScale = preview ? Math.min(1, (viewport?.width || window.innerWidth) / Number(document.getElementById('composition')?.dataset.width || window.innerWidth), (viewport?.height || window.innerHeight) / Number(document.getElementById('composition')?.dataset.height || window.innerHeight)) * Math.min(2, window.devicePixelRatio || 1) : 1;
    const ratio = Math.min(previewScale, Math.max(1920, resolution * 16 / 9) / Math.max(displayWidth, displayHeight));
    entry.nominalWidth=Math.max(1,Math.round(displayWidth*ratio));entry.nominalHeight=Math.max(1,Math.round(displayHeight*ratio));
    const detailRatio=Math.min(1,width/displayWidth,Math.max(1920,resolution*16/9)/Math.max(displayWidth,displayHeight));
    entry.detailWidth=Math.max(1,Math.round(displayWidth*detailRatio));entry.detailHeight=Math.max(1,Math.round(displayHeight*detailRatio));
    entry.gradeOnly=gradeOnly;entry.canvas=canvas;sizeOutput(entry,passes);
    if (reusable) {
      Object.assign(entry, reusable); entry.source.parentElement!.appendChild(canvas); return;
    }
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is unavailable. Enable hardware acceleration to preview these effects.');
    const program = makeProgram(gl,gradeOnly?gradeFragment:fragment);
    gl.useProgram(program);
    const buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const uniforms = Object.fromEntries(['parallax','parallaxCamera','impact','impactDetail','impactCenter','source','size','frame','softBlur','frameCorners','cornerWindow','invert','grade','balance','zoom','glitch','dither','ditherPalette','ditherShadow','ditherHighlight','neon','neonColor','neonPixel','lens','lensFringing','film','filmTone','filmPixel','textureTime','textureOutput','vhs','vhsMotion','lightLeak','lightLeakColor','directional','turbulence','sweep','sweepMotion','sweepColor','perspective','perspectiveFit','perspectiveBend','curves','curvesOn','hslBands','hslSpan','hslCenter','hslOn','lut','lutInfo','bloom'].map(name => [name, gl.getUniformLocation(program, name)]));
    Object.assign(entry, { canvas, gl, program, gradeOnly, texture, buffer, uniforms });
    entry.source.parentElement!.appendChild(canvas);
  }
  /** Upload a clip's curves, HSL and LUT once per change; textures sit on units 1 and 2. */
  function bindFinish(entry:Entry,finish:ColorFinishSource){
    const gl=entry.gl!,u=entry.uniforms!,key=JSON.stringify(finish);
    const texture=(existing:WebGLTexture|undefined)=>{const created=existing??gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,created);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return created;};
    if(entry.finishKey!==key){
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.activeTexture(gl.TEXTURE1);entry.curvesTexture=texture(entry.curvesTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,curvesTexture(finish.curves??{}));
      gl.activeTexture(gl.TEXTURE2);entry.lutTexture=texture(entry.lutTexture);
      const size=finish.lut?.custom?.size??17,atlas=finish.lut?.custom?customAtlas(finish.lut.custom):lookAtlas(finish.lut?.look??'film-warm',size);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size*size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,atlas);entry.lutSize=size;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      const spans=HSL_CENTERS.map((center,index)=>{const previous=HSL_CENTERS[(index+7)%8],next=HSL_CENTERS[(index+1)%8];return [((center-previous)+360)%360||360,((next-center)+360)%360||360];});
      gl.useProgram(entry.program!);gl.uniform3fv(u.hslBands,hslUniform(finish.hsl??{}));gl.uniform2fv(u.hslSpan,new Float32Array(spans.flat()));gl.uniform1fv(u.hslCenter,new Float32Array(HSL_CENTERS));
      entry.finishKey=key;
    }
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,entry.curvesTexture!);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,entry.lutTexture!);
  }
  /** Reuse GPU-only intermediate pixels; no readback or extra WebGL context. */
  function preparePassTargets(entry:Entry) {
    const gl=entry.gl!,canvas=entry.canvas!;
    entry.framebuffer??=gl.createFramebuffer()!;
    entry.passTextures??=[gl.createTexture()!,gl.createTexture()!];
    if(entry.passWidth===canvas.width&&entry.passHeight===canvas.height)return;
    gl.bindFramebuffer(gl.FRAMEBUFFER,entry.framebuffer);
    for(const texture of entry.passTextures){
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,canvas.width,canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Visual effect intermediate target is unavailable.');
    }
    entry.passWidth=canvas.width;entry.passHeight=canvas.height;
  }
  function draw(entry: Entry, force = false) {
    if (disposed || entry.failed) return;
    if(entry.gl?.isContextLost()){
      entry.failed=true;release(entry);report(new Error('WebGL context was lost. Reload the preview to restore these effects.'));return;
    }
    const now = clock.time(), start = Number(entry.source.dataset.start), end = start + Number(entry.source.dataset.duration);
    const video = videoOf(entry);
    if (video !== entry.listened) decoded(entry);
    const ahead = preparing(entry, now), time = ahead ? start : now;
    if (ahead) {
      // The warmup holds the next shot's element paused on its first frame. Anything else is a stale frame.
      const positioned = video!.paused && Math.abs(video!.currentTime - Number(video!.dataset.mediaStart ?? 0)) < .02;
      // A drawn first frame stays correct for the cut even if the element moves again.
      if (!positioned) return;
      if (!entry.canvas && !available.length && liveContexts() >= CONTEXT_BUDGET) return;
    }
    // Keyframed controls are evaluated in the clip's motion path time, the same clock as its movement.
    const animated=entry.effects.effectKeyframes?.length?{...entry.effects,...effectsAt(entry.effects,entry.effects.effectKeyframes,time-start+(entry.effects.motionOffset??0))}:entry.effects;
    const reactive=entry.effects.audioReactive,levels=reactive?(entry.levels??=decodeLevels(reactive.levels)):undefined;
    const passes=effectPasses(reactiveEffectsAt(animated,reactive,levels,time),time);
    if(nativeCorners(entry,passes))return;
    if (!passes.length || !ahead && !entry.source.hasAttribute('data-revline-transition-visible') && (time < start - 1e-6 || time >= end - 1e-6)) { if (entry.canvas) release(entry); return; }
    const renderId = entry.source.getAttribute('data-hf-render-id') || entry.source.id;
    const held = entry.source.hasAttribute('data-revline-transition-hold');
    const injected = held ? null : document.getElementById(`__render_frame_${renderId}__`) as HTMLImageElement | null;
    const source = injected || (video && video !== entry.source ? video : entry.source);
    if (source instanceof HTMLVideoElement ? source.readyState < 2 || source.seeking : !source.complete || !source.naturalWidth) return;
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!width || !height) return;
    const sourceKey = source instanceof HTMLVideoElement ? entry.decodedFrame ?? source.currentTime : source.currentSrc || source.src;
    const frame = Math.floor(time * fps + 1e-5);
    // Clip and timed-effect transforms change without changing the paused media frame.
    // Stop at the composition so viewing zoom remains a view of the same pixels.
    const transforms: string[] = [];
    for (let node: HTMLElement | null = entry.source; node && node.id !== 'composition'; node = node.parentElement) {
      if (node.style.transform && node.style.transform !== 'none') transforms.push(node.style.transform.includes('%') ? getComputedStyle(node).transform : node.style.transform);
    }
    const transformKey = transforms.join('|');
    const passKey=passes.map(pass=>pass.zoomBlur?.enabled?`${pass.zoomBlur.amount}:${pass.zoomBlur.centerX}:${pass.zoomBlur.centerY}`:pass.directionalBlur?.enabled?`directional:${pass.directionalBlur.amount}:${pass.directionalBlur.angle}`:pass.parallax?`parallax:${frame}`:pass.impact?`impact:${JSON.stringify(pass.impact)}`:'base').join('|');
    // CSS motion can run between decoded frames. Wait for the next video
    // frame before redrawing its bitmap; paused transforms still redraw now.
    const playingVideo = source instanceof HTMLVideoElement && !source.paused && !!source.requestVideoFrameCallback;
    const stableFrame=!(!!entry.effects.effectKeyframes?.length||hasReactiveEffects(entry.effects.audioReactive)||entry.effects.glitch?.enabled||entry.effects.filmOverlay?.enabled||entry.effects.vhs?.enabled&&entry.effects.vhs.speed>0||entry.effects.lightLeak?.enabled&&entry.effects.lightLeak.speed>0||entry.effects.turbulentDisplace?.enabled&&entry.effects.turbulentDisplace.speed>0||entry.effects.lightSweep?.enabled&&entry.effects.lightSweep.speed>0)||playingVideo||entry.lastFrame===frame;
    const stablePasses=playingVideo&&!entry.effects.parallax&&!timedEffects.some(clip=>clip.effectPreset==='impact-frame')?entry.lastPassCount===passes.length:entry.lastPassKey===passKey;
    if (!force && !entry.dirty && stableFrame && stablePasses && entry.lastSource === sourceKey && (playingVideo || entry.lastTransform === transformKey)) return;
    try {
      const gradeOnly=!preview&&passes.length===1&&!(passes[0] as VisualEffectInput).colorFinish&&!!passes[0].colorGrade?.enabled&&!passes[0].frameDistortion?.enabled&&!enabled({...passes[0],colorGrade:undefined})&&!entry.effects.cameraGlideBlur?.amount&&!timedEffects.some(clip=>clip.start<end&&clip.start+clip.duration>start);
      if(entry.canvas&&entry.gradeOnly!==gradeOnly)release(entry);
      if (!entry.canvas) initialize(entry, width, height,passes,gradeOnly);
      else sizeOutput(entry,passes);
      const { canvas, gl, uniforms: u } = entry;
      if (!canvas || !gl || !u) return;
      // Native media stays mounted and decoded; the replacement uses the exact same crop geometry.
      for (const key of ['left','top','width','height','objectFit','objectPosition','transform'] as const) canvas.style[key] = entry.source.style[key];
      canvas.style.position = 'absolute'; canvas.style.pointerEvents = 'none';
      gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(entry.program!); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, entry.texture!);
      if (entry.lastSource !== sourceKey || force && injected) {
        let textureSource: TexImageSource = source;
        if (source instanceof HTMLVideoElement && (held || preview && canvas.width < width)) {
          const upload = entry.uploadCanvas ??= document.createElement('canvas');
          if (upload.width !== canvas.width) upload.width = canvas.width;
          if (upload.height !== canvas.height) upload.height = canvas.height;
          upload.getContext('2d')!.drawImage(source, 0, 0, upload.width, upload.height);
          textureSource = upload;
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureSource);
      }
      const sourceDisplayWidth = parseFloat(entry.source.style.width) || width;
      const pixelScale = resolution / 1080 * width / sourceDisplayWidth;
      gl.uniform1i(u.source, 0); gl.uniform2f(u.size, width, height); gl.uniform1f(u.frame, frame);
      const transform = transforms.reduce((matrix, value) => matrix.multiply(new DOMMatrix(value)), new DOMMatrix());
      const clipScale = Math.max(.01, Math.hypot(transform.a, transform.b));
      const color = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
      if(passes.length>1)preparePassTargets(entry);
      for(const [index,effects] of passes.entries()){
        const pa=effects.parallax,im=effects.impact;
        const c=effects.colorGrade,z=effects.zoomBlur,g=effects.glitch,d=effects.dither,n=effects.neonEdges,l=effects.lensDistortion,f=effects.filmOverlay,v=effects.vhs,ll=effects.lightLeak,db=effects.directionalBlur,td=effects.turbulentDisplace,ls=effects.lightSweep,b=effects.softBlur,p=effects.frameDistortion;
        gl.bindTexture(gl.TEXTURE_2D,index===0?entry.texture!:entry.passTextures![(index-1)%2]);
        if(index===passes.length-1)gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        else{
          gl.bindFramebuffer(gl.FRAMEBUFFER,entry.framebuffer!);
          gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,entry.passTextures![index%2],0);
        }
        if(pa){
          entry.parallaxProgram??=makeProgram(gl,parallaxFragment);
          entry.parallaxUniforms??=Object.fromEntries(['source','size','parallax','parallaxCamera'].map(name=>[name,gl.getUniformLocation(entry.parallaxProgram!,name)]));
          gl.useProgram(entry.parallaxProgram);
          const pu=entry.parallaxUniforms,progress=Math.max(0,Math.min(1,(time-start+(entry.effects.motionOffset??0))/pa.duration));
          const travel=progress*progress*(3-2*progress);
          gl.uniform1i(pu.source,0);gl.uniform2f(pu.size,width,height);
          gl.uniform4f(pu.parallax,1,pa.panX*pa.amount,pa.panY*pa.amount,travel);
          const overscan=2*pa.amount*Math.max(Math.abs(pa.panX),Math.abs(pa.panY))+Math.abs(pa.orbit)*Math.PI/180;
          gl.uniform4f(pu.parallaxCamera,0,0,1+(pa.zoom-1+overscan)*travel,pa.orbit);
          gl.drawArrays(gl.TRIANGLES,0,6);continue;
        }
        gl.useProgram(entry.program!);
        if(im){
          entry.impactProgram??=makeProgram(gl,impactFragment);
          entry.impactUniforms??=Object.fromEntries(['source','size','impact','impactDetail','impactCenter'].map(name=>[name,gl.getUniformLocation(entry.impactProgram!,name)]));
          gl.useProgram(entry.impactProgram);
          const iu=entry.impactUniforms;
          gl.uniform1i(iu.source,0);gl.uniform2f(iu.size,width,height);
          gl.uniform4f(iu.impact,IMPACT_PRESETS.indexOf(im.preset)+1,im.intensity,im.threshold,im.levels);
          gl.uniform4f(iu.impactDetail,im.speedLines,im.flash,0,0);
          gl.uniform2f(iu.impactCenter,im.centerX,1-im.centerY);
          gl.drawArrays(gl.TRIANGLES,0,6);continue;
        }
        gl.uniform4f(u.perspective,p?.horizontal??0,p?.vertical??0,p?.skew??0,p?.enabled?1:0);
        gl.uniform1f(u.perspectiveFit,p?.enabled?frameDistortionFit(p):1);
        gl.uniform1f(u.perspectiveBend,p?.enabled?p.bend??0:0);
        gl.uniform1f(u.frameCorners,effects.frameCorners?.enabled?effects.frameCorners.amount:0);
        const sourceWidth=entry.source.offsetWidth||sourceDisplayWidth,sourceHeight=entry.source.offsetHeight||height,windowWidth=entry.source.parentElement!.clientWidth||sourceWidth,windowHeight=entry.source.parentElement!.clientHeight||sourceHeight;
        gl.uniform4f(u.cornerWindow,-entry.source.offsetLeft/sourceWidth,1+(entry.source.offsetTop-windowHeight)/sourceHeight,windowWidth/sourceWidth,windowHeight/sourceHeight);
        gl.uniform4f(u.lens,l?.enabled?l.amount:0,l?.centerX??.5,1-(l?.centerY??.5),0);
        gl.uniform1f(u.lensFringing,l?.enabled?l.fringing*pixelScale:0);
        gl.uniform4f(u.film,f?.enabled?f.amount:0,f?.grain??0,f?.dust??0,f?.scratches??0);
        gl.uniform4f(u.filmTone,0,f?.vignette??0,f?.flicker??0,f?.warmth??0);
        gl.uniform1f(u.filmPixel,pixelScale);
        gl.uniform1f(u.textureTime,frame/fps);gl.uniform2f(u.textureOutput,canvas.width,canvas.height);
        gl.uniform4f(u.vhs,v?.enabled?v.amount:0,v?.scanlines??0,v?.noise??0,v?.bleed??0);
        gl.uniform2f(u.vhsMotion,v?.tracking??0,v?.speed??0);
        gl.uniform4f(u.lightLeak,ll?.enabled?ll.amount:0,ll?.position??0,ll?.spread??0,ll?.speed??0);
        const leakColor=color(ll?.color??'#ff934f');gl.uniform3f(u.lightLeakColor,leakColor[0],leakColor[1],leakColor[2]);
        const blurAngle=(db?.angle??0)*Math.PI/180;
        gl.uniform3f(u.directional,db?.enabled?db.amount*pixelScale:0,Math.cos(blurAngle),-Math.sin(blurAngle));
        gl.uniform3f(u.turbulence,td?.enabled?td.amount*pixelScale:0,(td?.scale??120)*pixelScale,td?.speed??0);
        gl.uniform4f(u.sweep,ls?.enabled?ls.amount:0,(ls?.angle??0)*Math.PI/180,ls?.position??.5,ls?.width??.22);
        gl.uniform2f(u.sweepMotion,ls?.speed??0,0);
        const sweepColor=color(ls?.color??'#ffffff');gl.uniform3f(u.sweepColor,sweepColor[0],sweepColor[1],sweepColor[2]);
        gl.uniform1f(u.softBlur,b?.enabled?b.amount*pixelScale:0);
        const bl=effects.bloom;gl.uniform4f(u.bloom,bl?.enabled?bl.amount:0,bl?.threshold??.65,(bl?.radius??24)*pixelScale,0);
        const finish=(effects as VisualEffectInput).colorFinish;
        if(finish)bindFinish(entry,finish);
        gl.uniform1f(u.curvesOn,finish?.curves?1:0);gl.uniform1f(u.hslOn,finish?.hsl?1:0);gl.uniform2f(u.lutInfo,entry.lutSize??17,finish?.lut?finish.lut.amount:0);
        gl.uniform1i(u.curves,1);gl.uniform1i(u.lut,2);gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(u.invert,effects.invert?.enabled?effects.invert.amount:0);
        gl.uniform4f(u.grade,c?.enabled?c.exposure:0,c?.enabled?c.contrast:1,c?.enabled?c.saturation:1,0);
        gl.uniform3f(u.balance,c?.enabled?c.temperature/100:0,c?.enabled?c.tint/100:0,c?.enabled?c.vibrance/100:0);
        gl.uniform3f(u.zoom,z?.enabled?z.amount:0,z?.centerX??.5,1-(z?.centerY??.5));
        gl.uniform3f(u.glitch,g?.enabled?g.intensity:0,(g?.blockSize??32)*pixelScale,(g?.rgbSplit??8)*pixelScale);
        gl.uniform4f(u.neon,n?.enabled?n.amount:0,n?.detail??DEFAULT_NEON_EDGES.detail,n?.threshold??DEFAULT_NEON_EDGES.threshold,n?.glow??DEFAULT_NEON_EDGES.glow);
        gl.uniform1f(u.neonPixel,pixelScale/clipScale);
        const neonColor=entry.neonColor??defaultNeonColor;
        gl.uniform3f(u.neonColor,(neonColor>>>16&255)/255,(neonColor>>>8&255)/255,(neonColor&255)/255);
        gl.uniform3f(u.dither,d?.enabled?d.amount:0,d?.levels??4,(d?.size??2)*resolution/1080*canvas.width/sourceDisplayWidth/clipScale);
        const shadow=color(d?.shadowColor??'#000000'),highlight=color(d?.highlightColor??'#ffffff');
        gl.uniform1f(u.ditherPalette,d?.shadowColor||d?.highlightColor?1:0);
        gl.uniform3f(u.ditherShadow,shadow[0],shadow[1],shadow[2]);gl.uniform3f(u.ditherHighlight,highlight[0],highlight[1],highlight[2]);
        gl.drawArrays(gl.TRIANGLES,0,6);
      }
      entry.source.setAttribute('data-revline-effects', '');
      if (injected) { entry.injected = injected; injected.setAttribute('data-revline-effects', ''); }
      entry.lastFrame = frame; entry.lastSource = sourceKey; entry.lastTransform = transformKey; entry.lastPassKey=passKey; entry.lastPassCount=passes.length; entry.dirty = false;
    } catch (error) { entry.failed = true; release(entry); report(error); }
  }
  function redraw(force = false) {
    // Retire the outgoing clip first even when live splits appended it after
    // the incoming clip. Reuse its shader/context rather than compile at cuts.
    const time = clock.time();
    for (const entry of entries.values()) {
      const start = Number(entry.source.dataset.start), end = start + Number(entry.source.dataset.duration);
      if (entry.canvas && !preparing(entry, time) && !entry.source.hasAttribute('data-revline-transition-visible') && (time < start - 1e-6 || time >= end - 1e-6)) release(entry);
    }
    for (const entry of entries.values()) draw(entry, force);
  }
  function unlisten(entry: Entry) {
    const video = entry.listened;
    if (!video) return;
    if (entry.videoCallback !== undefined) video.cancelVideoFrameCallback(entry.videoCallback);
    if (entry.decodedListener) { video.removeEventListener('seeked', entry.decodedListener); video.removeEventListener('loadeddata', entry.decodedListener); }
    entry.listened = undefined; entry.videoCallback = undefined; entry.decodedListener = undefined; entry.decodedFrame = undefined;
  }
  function decoded(entry: Entry) {
    const video = videoOf(entry);
    if (video !== entry.listened) unlisten(entry);
    if (!video) return;
    entry.listened = video;
    if (!entry.decodedListener) {
      entry.decodedListener = () => { entry.decodedFrame = undefined; entry.dirty = true; draw(entry, true); };
      video.addEventListener('seeked', entry.decodedListener);
      video.addEventListener('loadeddata', entry.decodedListener);
    }
    if (!video.requestVideoFrameCallback) return;
    entry.videoCallback = video.requestVideoFrameCallback((_now, metadata) => {
      if (disposed || entries.get(entry.source.id) !== entry || entry.listened !== video) return;
      entry.decodedFrame = metadata.presentedFrames; entry.dirty = true; draw(entry, true); decoded(entry);
    });
  }
  function remove(id: string) {
    const previous = entries.get(id);
    if (previous) {
      clearNativeCorners(previous);
      unlisten(previous);
      release(previous); entries.delete(id);
    }
  }
  function set(id: string, effects: VisualEffectInput) {
    baseEffects.set(id,effects);
    const previous = entries.get(id);
    if (!effects.parallax&&!enabled(effects)&&!effects.colorFinish&&!effects.effectKeyframes?.length&&!hasReactiveEffects(effects.audioReactive)&&!(effects.cameraGlideBlur?.amount&&effects.cameraGlideBlur.amount>0)&&!timedEffects.some(clip=>clip.effectPreset==='impact-frame'||clip.zoomBlur?.enabled&&clip.zoomBlur.amount>0)) { remove(id); return; }
    const source = document.getElementById(id);
    if (!(source instanceof HTMLVideoElement || source instanceof HTMLImageElement)) return;
    const entry = previous ?? { source, effects, dirty: true };
    entry.effects = effects; entry.levels = undefined; entry.neonColor = effects.neonEdges ? Number.parseInt(effects.neonEdges.color.slice(1),16) : defaultNeonColor; entry.dirty = true; entry.failed = false; entries.set(id, entry);
    if (!previous) {
      decoded(entry);
      if(source instanceof HTMLImageElement)source.addEventListener('load',()=>{if(!disposed&&entries.get(id)===entry){entry.dirty=true;draw(entry,true);}},{once:true});
    }
    draw(entry);
  }
  const originalRender = clock.render,originalUpdate=clock.eventCallback?.('onUpdate') as (()=>void)|undefined;
  const update=()=>{originalUpdate?.call(clock);bindExportBridge();redraw();};
  const wrapped:Clock['render']=function(...args) { const result = originalRender.apply(clock, args); bindExportBridge(); redraw(); return result; };
  clock.render=wrapped;clock.eventCallback?.('onUpdate',update);
  // Pausing a native timeline does not necessarily render another frame. Clear
  // preview-only velocity blur immediately, including when the source is an image.
  const originalPaused=clock.paused;
  const paused:NonNullable<Clock['paused']>=function(value){if(value===undefined)return originalPaused!.call(clock);const result=originalPaused!.call(clock,value);redraw(true);return result;};
  if(preview&&originalPaused)clock.paused=paused;
  // Export injects FFmpeg-decoded image siblings, then calls this existing runtime bridge.
  // Chain its draw hook so capture waits for the same kernel after the injected image decodes.
  let bridge: { redraw?: () => void } | undefined, originalRedraw: (() => void) | undefined;
  function bindExportBridge() {
    const next = host.__hf?.colorGrading;
    if (!next || next === bridge) return;
    bridge = next; originalRedraw = next.redraw;
    next.redraw = () => { originalRedraw?.(); redraw(true); };
  }
  bindExportBridge(); document.addEventListener('DOMContentLoaded', bindExportBridge, { once: true });
  const controller: VisualEffectsController = {
    set,
    setTimedEffects:clips=>{timedEffects=clips.filter(clip=>clip.effectPreset==='zoom-blur'||clip.effectPreset==='impact-frame').sort((a,b)=>trackOf(a)-trackOf(b));for(const [id,effects] of baseEffects)set(id,effects);redraw(true);},
    redraw: () => { bindExportBridge(); redraw(true); },
    dispose: () => { disposed = true; for (const id of entries.keys()) remove(id); for (const resources of available) destroy(resources); available.length = 0; if(clock.render===wrapped)clock.render = originalRender;if(clock.paused===paused)clock.paused=originalPaused;if(clock.eventCallback?.('onUpdate')===update)clock.eventCallback?.('onUpdate',originalUpdate??null); if (bridge) bridge.redraw = originalRedraw; },
  };
  host.__revlineEffects = controller;
  for (const source of sources) set(source.id, source);
  window.addEventListener('pagehide', controller.dispose, { once: true });
}

export function visualEffectsRuntimeScript(sources: VisualEffectSource[], fps: number, resolution: number) {
  return `window.__revlineVisualEffects.installVisualEffects(${JSON.stringify(sources).replace(/</g, '\\u003c')},${fps},${resolution});`;
}
