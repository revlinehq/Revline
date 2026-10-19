import type { DemoCutPreviewPlan } from '@/lib/editor/f1-recording-demo';
import { waitForDemoStep } from '@/lib/editor/scripted-demo-chat';

/** Temporary pixels for the recording route. Canonical media changes once, via
 * commit; neither the player nor the timeline's React-owned nodes are replaced. */
export async function animateDemoCutPreview(root: HTMLElement, plan: DemoCutPreviewPlan, signal: AbortSignal, commit: () => void, onPhase: (phase: 'planned' | 'closing' | 'committed') => void) {
  if (!['f1-take-1', 'hormozi-take-1'].includes(root.dataset.demoId ?? '')) throw new Error('Cut previews belong to the scripted F1 demo.');
  signal.throwIfAborted();
  const area = root.querySelector<HTMLElement>('.timeline-track-area');
  if (!area) throw new Error('The demo timeline is not mounted.');
  const nodes = new Map(Array.from(area.querySelectorAll<HTMLElement>('.timeline-clip[data-clip-id]')).map(node => [node.dataset.clipId!, node]));
  const removed = plan.removedClipIds.map(id => nodes.get(id)), moving = plan.movingClipIds.map(id => nodes.get(id));
  if (removed.some(node => !node) || moving.some(node => !node)) throw new Error('The demo cut needs its linked video and audio.');
  const layer = document.createElement('div');
  layer.className = 'demo-cut-preview'; layer.setAttribute('aria-hidden', 'true');
  const animations: Animation[] = [], hidden = new Map<HTMLElement, string>();
  const local = new AbortController(), combined = AbortSignal.any([signal, local.signal]);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let committed = false;
  const clean = () => { animations.forEach(animation => animation.cancel()); layer.remove(); hidden.forEach((visibility, node) => { node.style.visibility = visibility; }); };
  const abort = () => { clean(); };
  signal.addEventListener('abort', abort, { once: true });
  const geometryChanged = () => local.abort('layout-changed');
  const initialWidth = area.clientWidth;
  const observer = new ResizeObserver(() => { if (area.clientWidth !== initialWidth) geometryChanged(); });
  observer.observe(area); window.addEventListener('resize', geometryChanged);
  const origin = area.getBoundingClientRect();
  function box(node: HTMLElement) {
    const rect = node.getBoundingClientRect();
    return { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height };
  }
  function place(node: HTMLElement, rect: ReturnType<typeof box>) {
    Object.assign(node.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    layer.appendChild(node);
  }
  function copy(node: HTMLElement) {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.dataset.demoCopyOf = node.dataset.clipId;
    clone.removeAttribute('data-clip-id'); clone.removeAttribute('role'); clone.removeAttribute('aria-pressed'); clone.removeAttribute('tabindex');
    clone.classList.remove('selected'); clone.classList.add('demo-cut-copy'); clone.inert = true;
    clone.querySelectorAll('button,input,[role=slider]').forEach(child => child.remove());
    const canvases = clone.querySelectorAll('canvas');
    node.querySelectorAll('canvas').forEach((canvas, index) => { canvases[index]?.getContext('2d')?.drawImage(canvas, 0, 0); });
    Object.assign(clone.style, { animation: 'none', margin: '0', visibility: 'visible' });
    place(clone, box(node)); hidden.set(node, node.style.visibility); node.style.visibility = 'hidden';
    return clone;
  }
  const animate = (node: HTMLElement, frames: Keyframe[], duration: number) => {
    const animation = node.animate(frames, { duration: reduced ? 0 : duration, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
    animations.push(animation); return animation;
  };
  try {
    const removedCopies = removed.map(node => copy(node!)), movingCopies = moving.map(node => copy(node!));
    const shades = removed.map(node => { const shade = document.createElement('div'); shade.className = 'demo-cut-shade'; place(shade, box(node!)); return shade; });
    moving.forEach(node => { const outline = document.createElement('div'); outline.className = 'demo-cut-old-position'; place(outline, box(node!)); });
    const label = document.createElement('div'); label.className = 'demo-cut-label'; label.textContent = 'Trimming';
    const target = box(removed[0]!); Object.assign(label.style, { left: `${target.left}px`, top: `${Math.max(2, target.top - 20)}px` }); layer.appendChild(label);
    area.appendChild(layer); onPhase('planned');
    shades.forEach(shade => animate(shade, [{ opacity: 0 }, { opacity: 1 }], 280));
    await waitForDemoStep(reduced ? 80 : 950, combined);
    removedCopies.forEach(node => animate(node, [{ opacity: 1 }, { opacity: 0 }], 380));
    shades.forEach(node => animate(node, [{ opacity: 1 }, { opacity: .12 }], 380));
    await waitForDemoStep(reduced ? 0 : 380, combined);
    onPhase('closing');
    const gap = target.width;
    movingCopies.forEach(node => animate(node, [{ transform: 'translateX(0)' }, { transform: `translateX(${-gap}px)` }], 1100));
    await waitForDemoStep(reduced ? 0 : 1100, combined);
    signal.throwIfAborted(); commit(); committed = true; onPhase('committed');
    // Keep the final preview pixels until React has painted the one canonical cut.
    await waitForDemoStep(40, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (local.signal.aborted && !committed) { clean(); commit(); onPhase('committed'); }
    else throw error;
  } finally {
    signal.removeEventListener('abort', abort); observer.disconnect(); window.removeEventListener('resize', geometryChanged); clean();
  }
}
