import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { VERSION } from 'remotion';
import { RemotionText } from './remotion-text-component';
import { remotionTextProps, type RemotionTextProps, type RemotionTextSource } from './remotion-text';
import { textLayerFrame, type TextLayerSource } from './text-layers';

const roots = new WeakMap<HTMLElement, { root: Root; props?: RemotionTextProps }>();
export const version = VERSION;

/** Called by the composition clock, including exact-frame export seeks. Never starts its own clock. */
export function render(host: HTMLElement, props: RemotionTextProps) {
  let entry = roots.get(host);
  const previous = entry?.props;
  if (previous && (Object.keys(props) as (keyof RemotionTextProps)[]).every(key => props[key] === previous[key])) return;
  if (!entry) { entry = { root: createRoot(host) }; roots.set(host, entry); }
  flushSync(() => entry.root.render(<RemotionText {...props}/>));
  entry.props = { ...props };
}

export function dispose(host: HTMLElement) {
  const entry = roots.get(host);
  if (!entry) return;
  flushSync(() => entry.root.unmount());
  roots.delete(host);
}

type Clock = { time(): number; render(time: number, suppressEvents?: boolean, force?: boolean): unknown; eventCallback(type: 'onUpdate', callback?: (() => void) | null): (() => void) | unknown };
export type RemotionTextController = { setSources(sources: RemotionTextSource[]): void; dispose(): void };

/** The host timeline remains the only clock, including producer's exact-frame export seeks. */
export function install(initialSources: RemotionTextSource[]): RemotionTextController {
  const registered = (window as Window & { __timelines?: { revline?: Clock & { __hfReal?: Clock } } }).__timelines?.revline;
  if (!registered) throw new Error('Text templates need the composition timeline.');
  // Producer's deferred-build proxy forwards seek to this underlying timeline.
  const clock = registered.__hfReal ?? registered;
  let sources = initialSources;
  const hosts = new Map<string, HTMLElement>();
  function paint() {
    for (const source of sources) {
      const host = document.querySelector<HTMLElement>(`#${source.id} .text-content`);
      if (!host) continue;
      hosts.set(source.id, host);
      render(host, { ...source.props, frame: Math.floor((clock!.time() - source.start + source.offset + 1e-7) * source.props.fps) });
    }
  }
  const previousRender = clock.render;
  const previousUpdate = clock.eventCallback('onUpdate') as (() => void) | undefined;
  const update = () => { previousUpdate?.call(clock); paint(); };
  // Producer sees this callback as animated content when checking static frames.
  clock.eventCallback('onUpdate', update);
  const wrapped: Clock['render'] = function (time, suppressEvents, force) {
    const result = previousRender.call(clock, time, suppressEvents, force);
    paint();
    return result;
  };
  clock.render = wrapped;
  paint();
  return {
    setSources(next) {
      const active = new Set(next.map(source => source.id));
      for (const [id, host] of hosts) if (!active.has(id)) { dispose(host); hosts.delete(id); }
      sources = next; paint();
    },
    dispose() {
      if (clock.render === wrapped) clock.render = previousRender;
      if (clock.eventCallback('onUpdate') === update) clock.eventCallback('onUpdate', previousUpdate ?? null);
      for (const host of hosts.values()) dispose(host);
      hosts.clear(); sources = [];
    },
  };
}


export type TextLayerController = { setSources(sources: TextLayerSource[]): void; dispose(): void };
/** Own only text DOM. Media elements and the host clock survive text structural edits. */
export function installTextLayers(initial: TextLayerSource[]): TextLayerController {
  const registered = (window as Window & { __timelines?: { revline?: Clock & { __hfReal?: Clock } } }).__timelines?.revline;
  if (!registered) throw new Error('Text layers need the composition timeline.');
  const clock = registered.__hfReal ?? registered;
  const composition = document.getElementById('composition')!;
  const width = Number(composition.dataset.width), height = Number(composition.dataset.height);
  let sources = initial, signature = JSON.stringify(initial);
  const nodes = new Map<string, HTMLElement>();
  const applied = new WeakMap<HTMLElement, TextLayerSource>();
  document.querySelectorAll<HTMLElement>('[data-text-clip]').forEach(node => nodes.set(node.dataset.textClip!, node));
  function paint() {
    for (const source of sources) {
      const { clip } = source;
      let node = nodes.get(clip.id);
      if (!node) {
        node = document.createElement('div'); node.id = `live-text-${encodeURIComponent(clip.id)}`; node.dataset.textClip = clip.id;
        const motion = document.createElement('span'); motion.className = 'text-motion';
        const content = document.createElement('span'); content.className = 'text-content'; motion.appendChild(content); node.appendChild(motion);
        const parent = Array.from(composition.querySelectorAll<HTMLElement>('.adjustment-layer')).find(layer => !layer.querySelector('.adjustment-layer')) ?? composition;
        parent.appendChild(node); nodes.set(clip.id, node);
      }
      const time = clock.time(), visible = time >= clip.start && time < clip.start + clip.duration;
      node.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const frame = textLayerFrame(source, time, width, height), style = frame.style;
      if (applied.get(node) !== source) {
        node.className = `overlay ${clip.kind}`;
        Object.assign(node.style, { left: `${style.x * 100}%`, top: `${style.y * 100}%`, fontSize: `${style.fontSize}px`, color: style.color, transform: style.transform, mixBlendMode: style.blendMode, zIndex: String((clip.track ?? 1) * 256 + source.index) });
        applied.set(node, source);
      }
      const motion = node.querySelector<HTMLElement>('.text-motion')!, content = node.querySelector<HTMLElement>('.text-content')!;
      Object.assign(motion.style, { transform: frame.transform, opacity: String(frame.opacity), filter: frame.brightness === 1 ? '' : `brightness(${frame.brightness})` });
      Object.assign(content.style, { background: style.background, transform: `translateY(${frame.lift}px)` });
      const props = remotionTextProps(clip, clock.time(), source.fps, source.resolution);
      if (props) render(content, props);
      else { dispose(content); if (content.textContent !== style.text) content.textContent = style.text; }
    }
  }
  const previousRender = clock.render, previousUpdate = clock.eventCallback('onUpdate') as (() => void) | undefined;
  const update = () => { previousUpdate?.call(clock); paint(); };
  const wrapped: Clock['render'] = function (time, suppressEvents, force) { const result = previousRender.call(clock, time, suppressEvents, force); paint(); return result; };
  clock.render = wrapped; clock.eventCallback('onUpdate', update); paint();
  return {
    setSources(next) {
      const nextSignature = JSON.stringify(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      const ids = new Set(next.map(source => source.clip.id));
      for (const [id, node] of nodes) if (!ids.has(id)) { dispose(node.querySelector<HTMLElement>('.text-content')!); node.remove(); nodes.delete(id); }
      sources = next; paint();
    },
    dispose() {
      if (clock.render === wrapped) clock.render = previousRender;
      if (clock.eventCallback('onUpdate') === update) clock.eventCallback('onUpdate', previousUpdate ?? null);
      for (const node of nodes.values()) dispose(node.querySelector<HTMLElement>('.text-content')!);
      nodes.clear(); sources = [];
    },
  };
}
