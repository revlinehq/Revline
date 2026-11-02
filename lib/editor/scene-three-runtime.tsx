// Loaded only in sandboxed scenes that import revline/three. React is shared with scene-react.
import * as React from 'react';
import { createRoot, extend, flushSync, useThree, type RootState, type ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FontData } from '@react-three/drei/core/useFont';
import { Text3D as DreiText3D } from '@react-three/drei/core/Text3D';
import { z } from 'zod';
import { modelResourceUris } from './scene-three-resources';
import { useSceneBridge, useScene } from './scene-react-runtime';

function isConstructor(value: unknown): value is new (...args: never[]) => object {
  if (typeof value !== 'function') return false;
  try { Reflect.construct(Object, [], value); return true; } catch { return false; }
}
const catalogue: Record<string, new (...args: never[]) => object> = {};
for (const [name, value] of Object.entries(THREE)) if (isConstructor(value)) catalogue[name] = value;
extend(catalogue);
const { useLayoutEffect, useMemo, useRef, useState } = React;
let nextResource = 0;
const requests = new Map<number, { resolve: (data: ArrayBuffer) => void; reject: (error: Error) => void }>();
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.source !== 'revline-scene-host' || event.data.type !== 'resource') return;
  const request = requests.get(event.data.id);
  if (!request) return;
  requests.delete(event.data.id);
  if (event.data.data instanceof ArrayBuffer) request.resolve(event.data.data);
  else request.reject(new Error(event.data.error || '3D resource could not load.'));
});
function resource(url: string) {
  // Project media is already an opaque blob delivered by the composition.
  if (/^(blob:|data:)/.test(url)) return fetch(url).then(response => response.arrayBuffer());
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const id = ++nextResource;
    requests.set(id, { resolve, reject });
    window.parent.postMessage({ source: 'revline-scene', type: 'resource', id, url }, '*');
  });
}

function useResource<T>(key: string, load: () => Promise<T>): T | null {
  if (typeof key !== 'string' || !key) throw new Error('A 3D resource needs a URL. Attach the project model as scene media before reading media.<name>.');
  const bridge = useSceneBridge();
  const [result, setResult] = useState<{ key: string; value: T } | null>(null);
  useLayoutEffect(() => {
    let active = true;
    bridge.hold(load().then(value => { if (active) flushSync(() => setResult({ key, value })); }));
    return () => { active = false; };
    // The resource identity is its URL, not the inline loader function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bridge]);
  return result && result.key === key ? result.value : null;
}

class SceneBoundary extends React.Component<{ children: React.ReactNode; fail: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.fail(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

type ThreeLayerProps = {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  camera?: { position?: [number, number, number]; fov?: number; near?: number; far?: number };
  /** Fixed across preview and export. Defaults to 1; bounded to 0.5–1 for CPU rendering. */
  dpr?: number;
};

/** Transparent R3F layer. A seek commits React, seeks GSAP, then renders GL before acknowledging paint. */
export function ThreeLayer({ children, style, camera, dpr = 1 }: ThreeLayerProps) {
  const { width, height } = useScene(), bridge = useSceneBridge();
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef<{ root: ReturnType<typeof createRoot>; state: RootState } | null>(null);
  const tree = useRef(children);
  tree.current = children;
  useLayoutEffect(() => {
    const element = canvas.current!;
    const root = createRoot(element);
    let disposed = false, failure: Error | null = null;
    const drawTree = () => bridge.wrap(<SceneBoundary fail={error => { failure = error; }}>{tree.current}</SceneBoundary>);
    const ready = root.configure({
      size: { width, height, top: 0, left: 0 }, dpr: Number.isFinite(dpr) ? Math.min(1, Math.max(.5, dpr)) : 1,
      frameloop: 'never', shadows: false,
      camera: { position: [0, 0, 6], fov: 40, near: .1, far: 100, ...camera },
      gl: { alpha: true, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: true },
    }).then(() => {
      if (disposed) return;
      let state: RootState | undefined;
      flushSync(() => { state = root.render(drawTree()).getState(); });
      if (state) active.current = { root, state };
    });
    bridge.hold(ready);
    const unregisterCommit = bridge.register(async () => { await ready; flushSync(() => bridge.notify()); }, 'commit');
    const unregister = bridge.register(async () => {
      await ready;
      if (failure) throw failure;
      const current = active.current;
      if (!current || disposed) return;
      // Render directly: no RAF, delta integration, controls, or wall-clock advance.
      let lights = 0;
      const materials = new Set<THREE.Material>();
      current.state.scene.traverse(object => {
        if (object instanceof THREE.Light) { lights++; object.castShadow = false; }
        if (object instanceof THREE.Mesh) {
          object.castShadow = false; object.receiveShadow = false;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            materials.add(material);
            if (material instanceof THREE.MeshPhysicalMaterial && (material.transmission > 0 || material.clearcoat > 0)) throw new Error('CPU 3D scenes use basic or standard materials without transmission or clearcoat.');
          }
        }
      });
      if (lights > 4 || materials.size > 32) throw new Error('CPU 3D scene limit: 4 lights and 32 materials per layer. Reuse materials and simplify the scene.');
      if (current.state.camera instanceof THREE.PerspectiveCamera || current.state.camera instanceof THREE.OrthographicCamera) current.state.camera.updateProjectionMatrix();
      current.state.gl.render(current.state.scene, current.state.camera);
      if (current.state.gl.info.render.calls > 128 || current.state.gl.info.render.triangles > 200000) throw new Error('CPU 3D scene limit: 128 draw calls and 200,000 triangles per layer. Use instances or simpler geometry.');
      current.state.gl.getContext().finish();
    }, 'draw');
    return () => { disposed = true; unregisterCommit(); unregister(); active.current = null; root.unmount(); };
    // Changing the scene's fixed size/quality recreates its GL context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, width, height, dpr]);
  useLayoutEffect(() => {
    const current = active.current;
    if (current) flushSync(() => current.root.render(bridge.wrap(<SceneBoundary fail={error => bridge.hold(Promise.reject(error))}>{children}</SceneBoundary>)));
  }, [children, bridge]);
  return <canvas ref={canvas} data-revline-three="" style={{ position: 'absolute', inset: 0, width, height, pointerEvents: 'none', ...style }} />;
}

async function loadModel(src: string) {
  const data = await resource(src);
  const uris = modelResourceUris(data);
  const base = /^https?:/.test(src) ? new URL('.', src).href : '';
  const urls = new Map<string, string>();
  try {
    await Promise.all(uris.map(async uri => {
      if (!base) throw new Error('Project models must be self-contained GLB files; bundle external buffers and textures into the GLB.');
      const url = new URL(uri, base).href;
      urls.set(url, URL.createObjectURL(new Blob([await resource(url)])));
    }));
    const manager = new THREE.LoadingManager();
    let failedResource: string | null = null;
    manager.onError = url => { failedResource = url; };
    manager.setURLModifier(url => urls.get(url) ?? url);
    const model = await new GLTFLoader(manager).parseAsync(data, base);
    if (failedResource) throw new Error('A model texture or buffer could not decode. Re-export a self-contained GLB.');
    return model;
  } finally { urls.forEach(url => URL.revokeObjectURL(url)); }
}

type ModelProps = Omit<ThreeElements['group'], 'children'> & { src: string; animation?: string; animationTime?: number };
/** GLB/glTF from HTTPS or useScene().media. Embedded animation is evaluated at absolute beat time. */
export function Model({ src, animation, animationTime, ...props }: ModelProps) {
  const model = useResource(src, () => loadModel(src));
  const bridge = useSceneBridge();
  useLayoutEffect(() => () => {
    model?.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
  }, [model]);
  const object = useMemo(() => model ? clone(model.scene) : null, [model]);
  useLayoutEffect(() => {
    if (!object || !model || !animation) return;
    const clip = model.animations.find(item => item.name === animation);
    if (!clip) throw new Error(`Model animation "${animation}" does not exist.`);
    const mixer = new THREE.AnimationMixer(object);
    mixer.clipAction(clip).play();
    const evaluate = async () => { mixer.setTime(Math.max(0, animationTime ?? bridge.time())); };
    // This must run before the layer's render, including the first captured frame.
    const unregister = bridge.register(evaluate);
    void evaluate();
    return () => { unregister(); mixer.stopAllAction(); mixer.uncacheRoot(object); };
  }, [object, model, animation, animationTime, bridge]);
  return object ? <group {...props}><primitive object={object} /></group> : null;
}

const typeface = z.object({ familyName: z.string(), resolution: z.number().positive(), underlineThickness: z.number(), boundingBox: z.object({ yMax: z.number(), yMin: z.number() }), glyphs: z.record(z.string(), z.object({ ha: z.number(), o: z.string().default(''), _cachedOutline: z.array(z.string()).optional() })) });

type Text3DProps = Omit<React.ComponentProps<typeof DreiText3D>, 'font'> & { font: string };
/** Extruded type. Supply a Three.js typeface JSON URL; normal HTML titles belong beside ThreeLayer. */
export function Text3D({ font, ...props }: Text3DProps) {
  const data = useResource(font, async () => typeface.parse(JSON.parse(new TextDecoder().decode(await resource(font)))));
  return data ? <DreiText3D curveSegments={4} bevelEnabled={false} {...props} font={data as FontData} /> : null;
}

export { useThree };
export const modules = { 'revline/three': { ThreeLayer, Model, Text3D, useThree }, three: THREE };
