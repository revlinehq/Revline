// Which GL backend export frames are drawn on. Servers keep SwiftShader; a GPU
// is used only when asked for and only after it draws Revline's effects correctly.
import { chmod, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// glvnd's NVIDIA EGL vendor. Without it, EGL on a hybrid machine resolves to Mesa
// and Chrome draws on the integrated GPU (an AMD iGPU on the dev PC: 60x slower).
const NVIDIA_EGL_VENDOR = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';
const PREFLIGHT_TIMEOUT_MS = 20_000;
// Chrome's own video decoder hands frames to the GPU as platform buffers that ANGLE's
// gl-egl backend cannot import: the GPU process crashes on load and Chrome blocks the
// page's WebGL, so effect canvases (the mirror-blur bands) silently fail. Export draws
// FFmpeg-decoded frames, so Chrome's decoder is not needed. HyperFrames takes no extra
// Chrome flags, so GPU renders launch Chrome through a wrapper that adds this one.
const GPU_CHROME_FLAGS = ['--disable-accelerated-video-decode'];
const log = message => console.error(`[revline] ${message}`);
/** Marks a GPU export strict (lib/editor/visual-effects-runtime.ts): an effect that cannot draw fails the frame. */
export const STRICT_EFFECTS_META = '<meta name="revline-strict-effects" content="true">';
/** The runtime's STRICT_EFFECTS_FAILURE prefix; kept in step by hand since this file runs without a bundler. */
export const STRICT_EFFECTS_FAILURE = 'Revline effects could not draw on this GPU:';

/**
 * Producer config overrides for the export's GL backend.
 * REVLINE_RENDER_GPU=1 asks for this machine's GPU. A non-software
 * PRODUCER_BROWSER_GPU_MODE is honoured too, but only after the same check.
 * Unset, or PRODUCER_BROWSER_GPU_MODE=software (the media processor image),
 * returns {} and launches nothing: rendering is unchanged.
 */
export async function renderGpuConfig(directory, env = process.env) {
  const requested = env.REVLINE_RENDER_GPU === '1' ? 'auto' : env.PRODUCER_BROWSER_GPU_MODE;
  if (requested !== 'auto' && requested !== 'hardware') return {};
  // Explicit GPU modes get the discrete GPU too.
  if (process.platform === 'linux' && !env.__EGL_VENDOR_LIBRARY_FILENAMES && existsSync(NVIDIA_EGL_VENDOR)) env.__EGL_VENDOR_LIBRARY_FILENAMES = NVIDIA_EGL_VENDOR;
  try {
    const { resolveHeadlessShellPath } = await import('@hyperframes/engine');
    const chrome = resolveHeadlessShellPath({});
    if (!chrome) throw new Error('chrome-headless-shell is not installed');
    const wrapper = join(directory, '.revline-gpu-chrome');
    await writeFile(wrapper, `#!/bin/sh\nexec ${shellQuote(chrome)} "$@" ${GPU_CHROME_FLAGS.join(' ')}\n`);
    await chmod(wrapper, 0o755);
    // The export's own footage: the crash above only shows once Chrome decodes real video.
    const video = (await readdir(directory)).find(name => /^asset-\d+.*\.(mp4|mov|m4v|webm)$/i.test(name));
    const renderer = await effectsPreflight(wrapper, video && join(directory, video));
    env.PRODUCER_HEADLESS_SHELL_PATH = wrapper;
    log(`GPU effects preflight passed on ${renderer}; drawing export frames on the GPU.`);
    return { browserGpuMode: 'hardware' };
  } catch (error) {
    log(`GPU effects preflight failed (${error instanceof Error ? error.message : String(error)}); drawing export frames with SwiftShader.`);
    return { browserGpuMode: 'software' };
  }
}


const shellQuote = value => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * Draws injected-frame images through several WebGL canvases, as the mirror-blur
 * bands do, with the exact Chrome flags HyperFrames uses for hardware capture.
 * Resolves with the GPU's name; rejects on a software renderer, a lost context,
 * a GL error or wrong pixels, since any of those would drop effects from the MP4.
 */
async function effectsPreflight(executablePath, video) {
  const [{ default: puppeteer }, { buildChromeArgs }] = await Promise.all([import('puppeteer'), import('@hyperframes/engine')]);
  const browser = await puppeteer.launch({
    headless: true, executablePath, timeout: PREFLIGHT_TIMEOUT_MS, handleSIGINT: false, handleSIGTERM: false,
    args: buildChromeArgs({ width: 256, height: 256, captureMode: 'screenshot' }, { browserGpuMode: 'hardware' }),
  });
  // A wedged GPU must not hold the render: past the deadline, kill this Chrome and use SwiftShader.
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { browser.process()?.kill('SIGKILL'); reject(new Error(`no answer within ${PREFLIGHT_TIMEOUT_MS / 1000}s`)); }, PREFLIGHT_TIMEOUT_MS); });
  try {
    const page = await browser.newPage();
    // Chrome opens a video file as a page holding one <video>: decode a few frames of it first.
    if (video) await Promise.race([deadline, page.goto(pathToFileURL(video).href, { waitUntil: 'domcontentloaded', timeout: PREFLIGHT_TIMEOUT_MS }).then(() => page.evaluate(async () => {
      const element = document.querySelector('video');
      if (!element) return;
      element.muted = true;
      await Promise.race([element.play().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
      await new Promise(resolve => setTimeout(resolve, 700));
      element.pause();
    }))]);
    const result = await Promise.race([deadline, page.evaluate(async () => {
      const size = 256, colors = [[220, 40, 30], [30, 200, 60], [40, 70, 230], [240, 220, 40]];
      const frames = await Promise.all(colors.map(async color => {
        const paint = document.createElement('canvas'); paint.width = paint.height = size;
        const context = paint.getContext('2d'); context.fillStyle = `rgb(${color})`; context.fillRect(0, 0, size, size);
        const image = new Image(); image.src = paint.toDataURL('image/jpeg', .95); await image.decode();
        document.body.appendChild(image); return { image, color };
      }));
      const contexts = [];
      for (let index = 0; index < 4; index++) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; document.body.appendChild(canvas);
        const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
        if (!gl) return { error: 'WebGL is unavailable' };
        const shader = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); return s; };
        const program = gl.createProgram();
        gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}'));
        // A small box blur: the same texture sampling the soft-blur pass relies on.
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 uv;uniform sampler2D t;void main(){vec4 c=vec4(0);for(int x=-2;x<=2;x++)for(int y=-2;y<=2;y++)c+=texture2D(t,uv+vec2(x,y)/256.);gl_FragColor=c/25.;}'));
        gl.linkProgram(program); gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        contexts.push(gl);
      }
      const pixel = new Uint8Array(4);
      for (let round = 0; round < 6; round++) {
        for (const [index, gl] of contexts.entries()) {
          const { image, color } = frames[(index + round) % frames.length];
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.readPixels(size / 2, size / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          const error = gl.getError();
          if (error !== gl.NO_ERROR) return { error: `GL error 0x${error.toString(16)}` };
          if (color.some((value, channel) => Math.abs(value - pixel[channel]) > 12)) return { error: `drew rgb(${[...pixel.slice(0, 3)]}) instead of rgb(${color})` };
        }
        // Lost contexts are reported asynchronously, after the GPU process gives up.
        await new Promise(resolve => setTimeout(resolve, 100));
        if (contexts.some(gl => gl.isContextLost())) return { error: 'a WebGL context was lost' };
      }
      const info = contexts[0].getExtension('WEBGL_debug_renderer_info');
      return { renderer: String(contexts[0].getParameter(info ? info.UNMASKED_RENDERER_WEBGL : contexts[0].RENDERER)) };
    })]);
    if (result.error) throw new Error(result.error);
    if (/swiftshader|llvmpipe|lavapipe|softpipe|software/i.test(result.renderer)) throw new Error(`software renderer ${result.renderer}`);
    return result.renderer;
  } finally {
    clearTimeout(timer);
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 2000))]).catch(() => {});
    browser.process()?.kill('SIGKILL');
  }
}
