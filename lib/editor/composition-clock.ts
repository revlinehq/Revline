/**
 * The composition's shared clock, as the in-page runtimes see it: the GSAP timeline the composition registers
 * as `window.__timelines.revline` (lib/editor/composition.ts). HyperFrames may wrap it; `__hfReal` is then
 * the underlying timeline, which the runtimes prefer. Types only: these modules run inside the iframe.
 */
export type CompositionClock = {
  time(): number;
  render(...args: unknown[]): unknown;
  eventCallback(name: string, callback?: (() => void) | null): unknown;
  paused?(value?: boolean): boolean | CompositionClock;
  __hfReal?: CompositionClock;
};

/** The composition window a runtime installs into; the composition script has registered the clock by then. */
export type CompositionClockHost = Window & { __timelines: { revline: CompositionClock } };
