type Rect = Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>;
type Paint = (clip: Rect, viewport: Rect) => void;

/** One scroll frame reads every visible clip before any subscriber paints. */
const observers = new WeakMap<HTMLElement, ReturnType<typeof createObserver>>();
function createObserver(viewport: HTMLElement) {
  const subscribers = new Map<HTMLElement, Paint>();
  // Clips the IntersectionObserver last reported outside the viewport (plus a margin). A scroll frame measures only
  // the others; a clip not reported yet counts as visible so its first paint is not delayed. A hidden clip keeps
  // its last paint and is measured again the moment it comes back into range.
  const hidden = new Set<HTMLElement>();
  let frame: number | null = null;
  const measure = () => {
    frame = null;
    const visible = viewport.getBoundingClientRect();
    const snapshots: { paint: Paint; rect: Rect }[] = [];
    for (const [node, paint] of subscribers) if (!hidden.has(node)) snapshots.push({ paint, rect: node.getBoundingClientRect() });
    for (const { paint, rect } of snapshots) paint(rect, visible);
  };
  const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
  const resize = new ResizeObserver(schedule);
  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) { const node = entry.target as HTMLElement; if (entry.isIntersecting || !subscribers.has(node)) hidden.delete(node); else hidden.add(node); }
    schedule();
  }, { root: viewport, rootMargin: '200px' });
  resize.observe(viewport);
  viewport.addEventListener('scroll', schedule, { passive: true });
  return {
    subscribe(node: HTMLElement, paint: Paint) {
      subscribers.set(node, paint); resize.observe(node); visibility.observe(node); schedule();
      return () => {
        subscribers.delete(node); hidden.delete(node); resize.unobserve(node); visibility.unobserve(node);
        if (subscribers.size) return;
        if (frame !== null) cancelAnimationFrame(frame);
        resize.disconnect(); visibility.disconnect(); hidden.clear(); viewport.removeEventListener('scroll', schedule);
        observers.delete(viewport);
      };
    },
    schedule,
  };
}

export function observeTimelineViewport(viewport: HTMLElement, node: HTMLElement, paint: Paint) {
  let observer = observers.get(viewport);
  if (!observer) { observer = createObserver(viewport); observers.set(viewport, observer); }
  return { schedule: observer.schedule, unsubscribe: observer.subscribe(node, paint) };
}
