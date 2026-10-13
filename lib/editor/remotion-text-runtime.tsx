import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { VERSION } from 'remotion';
import { RemotionText } from './remotion-text-component';
import type { RemotionTextProps, RemotionTextSource } from './remotion-text';

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
