import type { VisualEffects } from './visual-effects';
import { trackOf, type Clip } from './types';
import { adjustmentFrame } from './adjustment-layers';
import { NEON_EDGES_GLSL } from './neon-edges-shader';
import { DEFAULT_NEON_EDGES } from './neon-edges';
export { installAdjustmentLayers } from './adjustment-layers';
export { installVisualFades } from './visual-fades-runtime';

export type VisualEffectSource = VisualEffects & { id: string };
export type VisualEffectsController = { set(id: string, effects: VisualEffects): void; setTimedEffects(clips:Clip[]):void; redraw(): void; dispose(): void };

/** One browser bundle runs the same kernel in preview and exported compositions. */
export function installVisualEffects(sources: VisualEffectSource[], fps: number, resolution: number) {
  type Clock = { time(): number; render: (...args: unknown[]) => unknown };
  type RuntimeWindow = Window & { __timelines: { revline: Clock & { __hfReal?: Clock } }; __revlineEffects?: VisualEffectsController; __hf?: { colorGrading?: { redraw?: () => void } } };
  const host = window as unknown as RuntimeWindow;
  const preview = !!document.querySelector('meta[name="hyperframes-studio-preview"]');
  const clock = host.__timelines.revline.__hfReal ?? host.__timelines.revline;
  type Entry = { source: HTMLVideoElement | HTMLImageElement; effects: VisualEffects; neonColor?: number; canvas?: HTMLCanvasElement; gl?: WebGLRenderingContext; program?: WebGLProgram; texture?: WebGLTexture; buffer?: WebGLBuffer; uniforms?: Record<string, WebGLUniformLocation | null>; passTextures?: WebGLTexture[]; framebuffer?: WebGLFramebuffer; passWidth?: number; passHeight?: number; nominalWidth?: number; nominalHeight?: number; lastPassKey?: string; lastPassCount?: number; lastFrame?: number; lastSource?: string | number; lastTransform?: string; dirty: boolean; injected?: HTMLImageElement; failed?: boolean; videoCallback?: number; decodedFrame?: number; decodedListener?: () => void; uploadCanvas?: HTMLCanvasElement };
  type Resources = Pick<Entry, 'canvas' | 'gl' | 'program' | 'texture' | 'buffer' | 'uniforms' | 'passTextures' | 'framebuffer' | 'passWidth' | 'passHeight'>;
  const entries = new Map<string, Entry>();
  const available: Resources[] = [];
  let frameRequest = 0, disposed = false;
  const baseEffects=new Map<string,VisualEffects>();
  const defaultNeonColor=Number.parseInt(DEFAULT_NEON_EDGES.color.slice(1),16);
  let timedEffects:Clip[]=[];
  function effectPasses(base:VisualEffects,time:number):VisualEffects[] {
    const passes = enabled(base) ? [base] : [];
    for(const clip of timedEffects){
      if(!clip.zoomBlur?.enabled||time<clip.start||time>=clip.start+clip.duration)continue;
      const amount=clip.zoomBlur.amount*adjustmentFrame(clip,time).opacity;
      if(amount>0)passes.push({zoomBlur:{...clip.zoomBlur,amount}});
    }
    return passes;
  }
  const vertex = `attribute vec2 position;varying vec2 uv;void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.0,1.0);}`;
  const fragment = `precision highp float;
varying vec2 uv;uniform sampler2D source;uniform vec2 size;uniform float frame;
uniform float invert;uniform vec4 grade;uniform vec3 balance;uniform vec3 zoom;uniform vec3 glitch;uniform vec3 dither;uniform float ditherPalette;uniform vec3 ditherShadow;uniform vec3 ditherHighlight;
float bayer2(vec2 p){return p.y<1.0?(p.x<1.0?0.0:2.0):(p.x<1.0?3.0:1.0);}
float bayer4(vec2 p){p=mod(floor(p),4.0);return (4.0*bayer2(mod(p,2.0))+bayer2(floor(p/2.0))+0.5)/16.0;}
float hash(vec2 p){float n=mod(p.x*73.0+p.y*151.0+19.0,251.0);n=mod(n*n*17.0+n*13.0,65521.0);return mod(n*37.0,1021.0)/1021.0;}
vec4 sampleSource(vec2 p){return texture2D(source,clamp(p,vec2(0.0),vec2(1.0)));}
${NEON_EDGES_GLSL}
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
  vec2 p=uv;float split=0.0;
  if(glitch.x>0.0){
    float band=floor((1.0-p.y)*size.y/max(1.0,glitch.y));
    float seed=floor(frame/2.0);float gate=step(1.0-glitch.x*0.8,hash(vec2(band,seed)));
    p.x+=(hash(vec2(band+19.0,seed))-0.5)*0.24*glitch.x*gate;
    split=glitch.z/size.x*glitch.x;
  }
  vec4 c=radial(p);
  if(split>0.0){c.r=radial(p+vec2(split,0.0)).r;c.b=radial(p-vec2(split,0.0)).b;}
  // Exposure in stops, then warm/cool and green/magenta balance.
  vec3 rgb=c.rgb*exp2(grade.x);
  rgb*=vec3(1.0+balance.x*0.18+balance.y*0.08,1.0-balance.y*0.16,1.0-balance.x*0.18+balance.y*0.08);
  rgb=(rgb-0.5)*grade.y+0.5;
  float luma=dot(rgb,vec3(0.2126,0.7152,0.0722));
  float chroma=max(rgb.r,max(rgb.g,rgb.b))-min(rgb.r,min(rgb.g,rgb.b));
  float saturation=grade.z*(1.0+balance.z*(1.0-clamp(chroma,0.0,1.0)));
  rgb=clamp(mix(vec3(luma),rgb,saturation),0.0,1.0);
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
  gl_FragColor=vec4(rgb,c.a);
}`;

  function enabled(effects: VisualEffects) {
    const c = effects.colorGrade, z = effects.zoomBlur, g = effects.glitch;
    return !!(c?.enabled && (c.exposure || c.contrast !== 1 || c.saturation !== 1 || c.temperature || c.tint || c.vibrance) || z?.enabled && z.amount > 0 || g?.enabled && g.intensity > 0 || effects.invert?.enabled && effects.invert.amount > 0 || effects.dither?.enabled && effects.dither.amount > 0 || effects.neonEdges?.enabled && effects.neonEdges.amount > 0);
  }
  function release(entry: Entry) {
    entry.source.removeAttribute('data-revline-effects');
    entry.injected?.removeAttribute('data-revline-effects');
    entry.canvas?.remove();
    if (preview && !disposed && entry.canvas && entry.gl) {
      const { canvas, gl, program, texture, buffer, uniforms, passTextures, framebuffer, passWidth, passHeight } = entry;
      available.push({ canvas, gl, program, texture, buffer, uniforms, passTextures, framebuffer, passWidth, passHeight });
      if (available.length > 1) destroy(available.shift()!);
    } else destroy(entry);
    entry.gl = undefined; entry.canvas = undefined; entry.program = undefined; entry.uploadCanvas = undefined; entry.passTextures = undefined; entry.framebuffer = undefined; entry.passWidth = undefined; entry.passHeight = undefined; entry.lastSource = undefined; entry.lastFrame = undefined;
  }
  function destroy(resources: Resources) {
    const gl = resources.gl; if (!gl) return;
    gl.deleteTexture(resources.texture ?? null); gl.deleteBuffer(resources.buffer ?? null); gl.deleteProgram(resources.program ?? null);
    for(const texture of resources.passTextures??[])gl.deleteTexture(texture);
    gl.deleteFramebuffer(resources.framebuffer??null);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  function report(error: unknown) {
    const message = error instanceof Error ? error.message : 'Visual effects could not render.';
    document.documentElement.dataset.visualEffectsError = message;
    console.error('Revline visual effects:', message);
    window.dispatchEvent(new CustomEvent('revline-effects-error', { detail: message }));
  }
  function sizeOutput(entry:Entry,passes:number) {
    // Keep preview pixel work bounded when each FX layer adds a shader pass.
    // Export retains full composition density; block sizes remain screen-scaled.
    const budget=preview?Math.sqrt(passes):1,canvas=entry.canvas!;
    const width=Math.max(1,Math.round(entry.nominalWidth!/budget)),height=Math.max(1,Math.round(entry.nominalHeight!/budget));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;entry.lastSource=undefined;}
  }
  function initialize(entry: Entry, width: number, height: number, passes:number) {
    const reusable = preview ? available.pop() : undefined;
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
    entry.canvas=canvas;sizeOutput(entry,passes);
    if (reusable) {
      Object.assign(entry, reusable); entry.source.parentElement!.appendChild(canvas); return;
    }
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is unavailable. Enable hardware acceleration to preview these effects.');
    const compile = (type: number, code: string) => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, code); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`Visual effect shader failed: ${log}`); }
      return shader;
    };
    const program = gl.createProgram()!, vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Visual effect shader could not link.');
    gl.useProgram(program);
    const buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const uniforms = Object.fromEntries(['source','size','frame','invert','grade','balance','zoom','glitch','dither','ditherPalette','ditherShadow','ditherHighlight','neon','neonColor','neonPixel'].map(name => [name, gl.getUniformLocation(program, name)]));
    Object.assign(entry, { canvas, gl, program, texture, buffer, uniforms });
    entry.source.parentElement!.appendChild(canvas);
  }
  /** Reuse GPU-only intermediate pixels; no readback or extra WebGL context. */
  function preparePassTargets(entry:Entry) {
    const gl=entry.gl!,canvas=entry.canvas!;
    entry.framebuffer??=gl.createFramebuffer()!;
    entry.passTextures??=[gl.createTexture()!,gl.createTexture()!];
    if(entry.passWidth===canvas.width&&entry.passHeight===canvas.height)return;
    for(const texture of entry.passTextures){
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,canvas.width,canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    }
    entry.passWidth=canvas.width;entry.passHeight=canvas.height;
  }
  function draw(entry: Entry, force = false) {
    if (disposed || entry.failed) return;
    const time = clock.time(), start = Number(entry.source.dataset.start), end = start + Number(entry.source.dataset.duration);
    const passes=effectPasses(entry.effects,time);
    if (!passes.length || !entry.source.hasAttribute('data-revline-transition-visible') && (time < start - 1e-6 || time >= end - 1e-6)) { if (entry.canvas) release(entry); return; }
    const renderId = entry.source.getAttribute('data-hf-render-id') || entry.source.id;
    const held = entry.source.hasAttribute('data-revline-transition-hold');
    const injected = held ? null : document.getElementById(`__render_frame_${renderId}__`) as HTMLImageElement | null;
    const source = injected || entry.source;
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
    const passKey=passes.map(pass=>pass.zoomBlur?.enabled?`${pass.zoomBlur.amount}:${pass.zoomBlur.centerX}:${pass.zoomBlur.centerY}`:'base').join('|');
    // CSS motion can run between decoded frames. Wait for the next video
    // frame before redrawing its bitmap; paused transforms still redraw now.
    const playingVideo = source instanceof HTMLVideoElement && !source.paused && !!source.requestVideoFrameCallback;
    const stableFrame=!entry.effects.glitch?.enabled||playingVideo||entry.lastFrame===frame;
    const stablePasses=playingVideo?entry.lastPassCount===passes.length:entry.lastPassKey===passKey;
    if (!force && !entry.dirty && stableFrame && stablePasses && entry.lastSource === sourceKey && (playingVideo || entry.lastTransform === transformKey)) return;
    try {
      if (!entry.canvas) initialize(entry, width, height,passes.length);
      else sizeOutput(entry,passes.length);
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
        const c=effects.colorGrade,z=effects.zoomBlur,g=effects.glitch,d=effects.dither,n=effects.neonEdges;
        gl.bindTexture(gl.TEXTURE_2D,index===0?entry.texture!:entry.passTextures![(index-1)%2]);
        if(index===passes.length-1)gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        else{
          gl.bindFramebuffer(gl.FRAMEBUFFER,entry.framebuffer!);
          gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,entry.passTextures![index%2],0);
          if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Visual effect intermediate target is unavailable.');
        }
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
    } catch (error) { release(entry); entry.failed = true; report(error); }
  }
  function redraw(force = false) {
    // Retire the outgoing clip first even when live splits appended it after
    // the incoming clip. Reuse its shader/context rather than compile at cuts.
    const time = clock.time();
    for (const entry of entries.values()) {
      const start = Number(entry.source.dataset.start), end = start + Number(entry.source.dataset.duration);
      if (entry.canvas && !entry.source.hasAttribute('data-revline-transition-visible') && (time < start - 1e-6 || time >= end - 1e-6)) release(entry);
    }
    for (const entry of entries.values()) draw(entry, force);
  }
  function tick() { frameRequest = 0; if (disposed) return; bindExportBridge(); redraw(); if (entries.size) frameRequest = requestAnimationFrame(tick); }
  function decoded(entry: Entry) {
    if (!(entry.source instanceof HTMLVideoElement)) return;
    const video = entry.source;
    if (!entry.decodedListener) {
      entry.decodedListener = () => { entry.decodedFrame = undefined; entry.dirty = true; draw(entry, true); };
      video.addEventListener('seeked', entry.decodedListener);
      video.addEventListener('loadeddata', entry.decodedListener);
    }
    if (!video.requestVideoFrameCallback) return;
    entry.videoCallback = video.requestVideoFrameCallback((_now, metadata) => {
      if (disposed || entries.get(video.id) !== entry) return;
      entry.decodedFrame = metadata.presentedFrames; entry.dirty = true; draw(entry, true); decoded(entry);
    });
  }
  function remove(id: string) {
    const previous = entries.get(id);
    if (previous) {
      if (previous.source instanceof HTMLVideoElement && previous.videoCallback !== undefined) previous.source.cancelVideoFrameCallback(previous.videoCallback);
      if (previous.decodedListener) { previous.source.removeEventListener('seeked', previous.decodedListener); previous.source.removeEventListener('loadeddata', previous.decodedListener); }
      release(previous); entries.delete(id);
    }
  }
  function set(id: string, effects: VisualEffects) {
    baseEffects.set(id,effects);
    const previous = entries.get(id);
    if (!enabled(effects)&&!timedEffects.some(clip=>clip.zoomBlur?.enabled&&clip.zoomBlur.amount>0)) { remove(id); if (!entries.size) { cancelAnimationFrame(frameRequest); frameRequest = 0; } return; }
    const source = document.getElementById(id);
    if (!(source instanceof HTMLVideoElement || source instanceof HTMLImageElement)) return;
    const entry = previous ?? { source, effects, dirty: true };
    entry.effects = effects; entry.neonColor = effects.neonEdges ? Number.parseInt(effects.neonEdges.color.slice(1),16) : defaultNeonColor; entry.dirty = true; entry.failed = false; entries.set(id, entry); if (!previous) decoded(entry); draw(entry);
    if (!frameRequest) frameRequest = requestAnimationFrame(tick);
  }
  const originalRender = clock.render;
  clock.render = function(...args) { const result = originalRender.apply(clock, args); bindExportBridge(); redraw(); return result; };
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
    setTimedEffects:clips=>{timedEffects=clips.filter(clip=>clip.effectPreset==='zoom-blur').sort((a,b)=>trackOf(a)-trackOf(b));for(const [id,effects] of baseEffects)set(id,effects);redraw(true);},
    redraw: () => { bindExportBridge(); redraw(true); },
    dispose: () => { disposed = true; cancelAnimationFrame(frameRequest); for (const id of entries.keys()) remove(id); for (const resources of available) destroy(resources); available.length = 0; clock.render = originalRender; if (bridge) bridge.redraw = originalRedraw; },
  };
  host.__revlineEffects = controller;
  for (const source of sources) set(source.id, source);
  window.addEventListener('pagehide', controller.dispose, { once: true });
}

export function visualEffectsRuntimeScript(sources: VisualEffectSource[], fps: number, resolution: number) {
  return `window.__revlineVisualEffects.installVisualEffects(${JSON.stringify(sources).replace(/</g, '\\u003c')},${fps},${resolution});`;
}
