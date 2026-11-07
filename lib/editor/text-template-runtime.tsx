import { textGradientFill } from './text-gradient';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TemplateText } from './template-text';
import { templateTextProps, type TemplateTextProps, type TemplateTextSource } from './text-templates';
import { textLayerFrame, type TextLayerSource } from './text-layers';
import { resolvedTextAppearance, textAppearance } from './text-style';

const roots = new WeakMap<HTMLElement, { root: Root; props?: TemplateTextProps }>();

/** Called by the composition clock, including exact-frame export seeks. Never starts its own clock. */
export function render(host: HTMLElement, props: TemplateTextProps) {
  let entry = roots.get(host);
  const previous = entry?.props;
  if (previous && Object.keys(props).length === Object.keys(previous).length && (Object.keys(props) as (keyof TemplateTextProps)[]).every(key => props[key] === previous[key])) return;
  if (!entry) { entry = { root: createRoot(host) }; roots.set(host, entry); }
  flushSync(() => entry.root.render(<TemplateText {...props}/>));
  entry.props = { ...props };
}

export function dispose(host: HTMLElement) {
  const entry = roots.get(host);
  if (!entry) return;
  flushSync(() => entry.root.unmount());
  roots.delete(host);
}

type Clock = { time(): number; render(time: number, suppressEvents?: boolean, force?: boolean): unknown; eventCallback(type: 'onUpdate', callback?: (() => void) | null): (() => void) | unknown };
export type TemplateTextController = { setSources(sources: TemplateTextSource[]): void; dispose(): void };

/** The host timeline remains the only clock, including producer's exact-frame export seeks. */
export function install(initialSources: TemplateTextSource[]): TemplateTextController {
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
      render(host, { ...source.props, ...(source.props.textGradient?{gradientTime:clock!.time()-source.start}:{}), frame: Math.floor((clock!.time() - source.start + source.offset + 1e-7) * source.props.fps) });
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
        Object.assign(node.style, { left: `${style.x * 100}%`, top: `${style.y * 100}%`, fontSize: `${style.fontSize}px`, fontFamily: style.fontFamily, fontWeight: String(style.fontWeight), fontStyle: style.fontStyle, letterSpacing: `${style.letterSpacing}px`, lineHeight: String(style.lineHeight), textAlign: style.textAlign, color: style.color, transform: style.transform, mixBlendMode: style.blendMode, zIndex: String((clip.track ?? 1) * 256 + source.index) });
        applied.set(node, source);
      }
      const motion = node.querySelector<HTMLElement>('.text-motion')!, content = node.querySelector<HTMLElement>('.text-content')!;
      Object.assign(motion.style, { transform: frame.transform, opacity: String(frame.opacity), filter: [frame.brightness === 1 ? '' : `brightness(${frame.brightness})`, frame.blur > .05 ? `blur(${frame.blur.toFixed(2)}px)` : ''].filter(Boolean).join(' ') });
      const appearance = clip.textStyle || clip.textGradient ? textAppearance({textStyle:resolvedTextAppearance(clip)}, source.resolution) : {WebkitTextStroke:'',paintOrder:'',textShadow:''};
      Object.assign(content.style, { ...appearance, background: style.background, padding: `${style.paddingY}px ${style.paddingX}px`, borderRadius: `${style.borderRadius}px`, transform: `translateY(${frame.lift}px)` });
      const props = templateTextProps(clip, clock.time(), source.fps, source.resolution);
      if (props) render(content, props);
      else {
        dispose(content);
        let fill=content.querySelector<HTMLElement>(':scope > [data-text-fill]');
        if(!fill){fill=document.createElement('span');fill.dataset.textFill='';content.replaceChildren(fill);}
        if(fill.textContent!==style.text)fill.textContent=style.text;
        fill.removeAttribute('style');
        Object.assign(fill.style,textGradientFill(clip.textGradient,time-clip.start,appearance.textShadow));
      }
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
