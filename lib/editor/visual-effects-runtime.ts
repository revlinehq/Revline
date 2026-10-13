import type { VisualEffects } from './visual-effects';

export type VisualEffectSource = VisualEffects & { id: string };
export type VisualEffectsController = { set(id: string, effects: VisualEffects): void; redraw(): void; dispose(): void };

/** One browser bundle runs the same kernel in preview and exported compositions. */
export function installVisualEffects(sources: VisualEffectSource[], fps: number, resolution: number) {
  type Clock = { time(): number; render: (...args: unknown[]) => unknown };
  type RuntimeWindow = Window & { __timelines: { revline: Clock & { __hfReal?: Clock } }; __revlineEffects?: VisualEffectsController; __hf?: { colorGrading?: { redraw?: () => void } } };
  const host = window as unknown as RuntimeWindow;
  const clock = host.__timelines.revline.__hfReal ?? host.__timelines.revline;
  const entries = new Map<string, { source: HTMLVideoElement | HTMLImageElement; effects: VisualEffects; canvas?: HTMLCanvasElement; gl?: WebGLRenderingContext; program?: WebGLProgram; texture?: WebGLTexture; buffer?: WebGLBuffer; uniforms?: Record<string, WebGLUniformLocation | null>; lastFrame?: number; lastSource?: string | number; dirty: boolean; injected?: HTMLImageElement; failed?: boolean; videoCallback?: number; decodedFrame?: number; decodedListener?: () => void }>();
  let frameRequest = 0, disposed = false;
  const vertex = `attribute vec2 position;varying vec2 uv;void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.0,1.0);}`;
  const fragment = `precision highp float;
varying vec2 uv;uniform sampler2D source;uniform vec2 size;uniform float frame;
uniform float invert;uniform vec4 grade;uniform vec3 balance;uniform vec3 zoom;uniform vec3 glitch;
float hash(vec2 p){float n=mod(p.x*73.0+p.y*151.0+19.0,251.0);n=mod(n*n*17.0+n*13.0,65521.0);return mod(n*37.0,1021.0)/1021.0;}
vec4 sampleSource(vec2 p){return texture2D(source,clamp(p,vec2(0.0),vec2(1.0)));}
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
  gl_FragColor=vec4(mix(rgb,1.0-rgb,invert),c.a);
}`;

  function enabled(effects: VisualEffects) {
    const c = effects.colorGrade, z = effects.zoomBlur, g = effects.glitch;
    return !!(c?.enabled && (c.exposure || c.contrast !== 1 || c.saturation !== 1 || c.temperature || c.tint || c.vibrance) || z?.enabled && z.amount > 0 || g?.enabled && g.intensity > 0 || effects.invert?.enabled && effects.invert.amount > 0);
  }
  function release(entry: typeof entries extends Map<string, infer T> ? T : never) {
    entry.source.removeAttribute('data-revline-effects');
    entry.injected?.removeAttribute('data-revline-effects');
    entry.canvas?.remove();
    if (entry.gl) {
      entry.gl.deleteTexture(entry.texture ?? null); entry.gl.deleteBuffer(entry.buffer ?? null); entry.gl.deleteProgram(entry.program ?? null);
      entry.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    entry.gl = undefined; entry.canvas = undefined; entry.program = undefined; entry.lastSource = undefined; entry.lastFrame = undefined;
  }
  function report(error: unknown) {
    const message = error instanceof Error ? error.message : 'Visual effects could not render.';
    document.documentElement.dataset.visualEffectsError = message;
    console.error('Revline visual effects:', message);
    window.dispatchEvent(new CustomEvent('revline-effects-error', { detail: message }));
  }
  function initialize(entry: typeof entries extends Map<string, infer T> ? T : never, width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.className = 'visual-effect-output'; canvas.dataset.effectSource = entry.source.id;
    // Match the composition's pixel density while avoiding oversized source canvases.
    const displayWidth = entry.source.style.width.endsWith('px') ? parseFloat(entry.source.style.width) : width;
    const displayHeight = displayWidth * height / width;
    const ratio = Math.min(1, Math.max(1920, resolution * 16 / 9) / Math.max(displayWidth, displayHeight));
    canvas.width = Math.max(1, Math.round(displayWidth * ratio)); canvas.height = Math.max(1, Math.round(displayHeight * ratio));
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
    const uniforms = Object.fromEntries(['source','size','frame','invert','grade','balance','zoom','glitch'].map(name => [name, gl.getUniformLocation(program, name)]));
    Object.assign(entry, { canvas, gl, program, texture, buffer, uniforms });
    entry.source.parentElement!.appendChild(canvas);
  }
  function draw(entry: typeof entries extends Map<string, infer T> ? T : never, force = false) {
    if (disposed || entry.failed) return;
    const time = clock.time(), start = Number(entry.source.dataset.start), end = start + Number(entry.source.dataset.duration);
    if (!enabled(entry.effects) || time < start - 1e-6 || time >= end - 1e-6) { if (entry.canvas) release(entry); return; }
    const renderId = entry.source.getAttribute('data-hf-render-id') || entry.source.id;
    const injected = document.getElementById(`__render_frame_${renderId}__`) as HTMLImageElement | null;
    const source = injected || entry.source;
    if (source instanceof HTMLVideoElement ? source.readyState < 2 || source.seeking : !source.complete || !source.naturalWidth) return;
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!width || !height) return;
    const sourceKey = source instanceof HTMLVideoElement ? entry.decodedFrame ?? source.currentTime : source.currentSrc || source.src;
    const frame = Math.floor(time * fps + 1e-5);
    if (!force && !entry.dirty && entry.lastFrame === frame && entry.lastSource === sourceKey) return;
    try {
      if (!entry.canvas) initialize(entry, width, height);
      const { canvas, gl, uniforms: u } = entry;
      if (!canvas || !gl || !u) return;
      // Native media stays mounted and decoded; the replacement uses the exact same crop geometry.
      for (const key of ['left','top','width','height','objectFit','objectPosition','transform'] as const) canvas.style[key] = entry.source.style[key];
      canvas.style.position = 'absolute'; canvas.style.pointerEvents = 'none';
      gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(entry.program!); gl.bindTexture(gl.TEXTURE_2D, entry.texture!);
      if (force || entry.lastSource !== sourceKey) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      const c = entry.effects.colorGrade, z = entry.effects.zoomBlur, g = entry.effects.glitch;
      const sourceDisplayWidth = parseFloat(entry.source.style.width) || width;
      const pixelScale = resolution / 1080 * width / sourceDisplayWidth;
      gl.uniform1i(u.source, 0); gl.uniform2f(u.size, width, height); gl.uniform1f(u.frame, frame);
      gl.uniform1f(u.invert, entry.effects.invert?.enabled ? entry.effects.invert.amount : 0);
      gl.uniform4f(u.grade, c?.enabled ? c.exposure : 0, c?.enabled ? c.contrast : 1, c?.enabled ? c.saturation : 1, 0);
      gl.uniform3f(u.balance, c?.enabled ? c.temperature / 100 : 0, c?.enabled ? c.tint / 100 : 0, c?.enabled ? c.vibrance / 100 : 0);
      gl.uniform3f(u.zoom, z?.enabled ? z.amount : 0, z?.centerX ?? .5, 1 - (z?.centerY ?? .5));
      gl.uniform3f(u.glitch, g?.enabled ? g.intensity : 0, (g?.blockSize ?? 32) * pixelScale, (g?.rgbSplit ?? 8) * pixelScale);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      entry.source.setAttribute('data-revline-effects', '');
      if (injected) { entry.injected = injected; injected.setAttribute('data-revline-effects', ''); }
      entry.lastFrame = frame; entry.lastSource = sourceKey; entry.dirty = false;
    } catch (error) { release(entry); entry.failed = true; report(error); }
  }
  function redraw(force = false) { for (const entry of entries.values()) draw(entry, force); }
  function tick() { frameRequest = 0; if (disposed) return; bindExportBridge(); redraw(); if (entries.size) frameRequest = requestAnimationFrame(tick); }
  function decoded(entry: typeof entries extends Map<string, infer T> ? T : never) {
    if (!(entry.source instanceof HTMLVideoElement)) return;
    const video = entry.source;
    if (!entry.decodedListener) {
      entry.decodedListener = () => { entry.dirty = true; draw(entry, true); };
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
    const previous = entries.get(id);
    if (!enabled(effects)) { remove(id); if (!entries.size) { cancelAnimationFrame(frameRequest); frameRequest = 0; } return; }
    const source = document.getElementById(id);
    if (!(source instanceof HTMLVideoElement || source instanceof HTMLImageElement)) return;
    const entry = previous ?? { source, effects, dirty: true };
    entry.effects = effects; entry.dirty = true; entry.failed = false; entries.set(id, entry); if (!previous) decoded(entry); draw(entry);
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
    redraw: () => { bindExportBridge(); redraw(true); },
    dispose: () => { disposed = true; cancelAnimationFrame(frameRequest); for (const id of entries.keys()) remove(id); clock.render = originalRender; if (bridge) bridge.redraw = originalRedraw; },
  };
  host.__revlineEffects = controller;
  for (const source of sources) set(source.id, source);
  window.addEventListener('pagehide', controller.dispose, { once: true });
}

export function visualEffectsRuntimeScript(sources: VisualEffectSource[], fps: number, resolution: number) {
  return `window.__revlineVisualEffects.installVisualEffects(${JSON.stringify(sources).replace(/</g, '\\u003c')},${fps},${resolution});`;
}
