import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationScroll } from './use-conversation-scroll';

const mounted = vi.hoisted(() => ({ effects: [] as (() => void)[] }));
vi.mock('react', () => ({
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(value: T) => [value, vi.fn()],
  useCallback: <T>(callback: T) => callback,
  useLayoutEffect: (effect: () => void) => { mounted.effects.push(effect); },
}));

beforeEach(() => {
  mounted.effects.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

function openChat({ turnTop = 4, replyBottom = 280, scrollHeight = 662 } = {}) {
  const hook = useConversationScroll('latest-request', true);
  let scrollTop = 0;
  const properties = new Map<string, string>();
  const style = { getPropertyValue: (name: string) => properties.get(name) ?? '', setProperty: (name: string, value: string) => { properties.set(name, value); } };
  const reply = { getBoundingClientRect: () => ({ bottom: 72 + replyBottom - scrollTop }) };
  const turn = { getBoundingClientRect: () => ({ top: 72 + turnTop - scrollTop }), querySelector: () => reply };
  hook.viewport.current = {
    clientHeight: 636, scrollHeight, offsetWidth: 320, clientWidth: 306,
    get scrollTop() { return scrollTop; }, set scrollTop(value: number) { scrollTop = value; },
    getBoundingClientRect: () => ({ top: 72 }), querySelector: () => turn,
    querySelectorAll: () => [],
    style, parentElement: { style }, addEventListener() {}, removeEventListener() {},
  } as unknown as HTMLDivElement;
  hook.content.current = { querySelectorAll: () => [] } as unknown as HTMLDivElement;
  hook.composer.current = { offsetHeight: 146 } as HTMLDivElement;
  mounted.effects.forEach(effect => effect());
  return { scrollTop: () => scrollTop, requestTop: () => 72 + turnTop - scrollTop, replyBottom: () => 72 + replyBottom - scrollTop };
}

describe('initial conversation anchoring', () => {
  it('keeps the demo request visible when a note below the reply adds 26px of overflow', () => {
    const chat = openChat();
    expect(chat.scrollTop()).toBe(0);
    expect(chat.requestTop()).toBeGreaterThanOrEqual(72);
  });

  it('opens an existing conversation at its latest request with the top inset', () => {
    const chat = openChat({ turnTop: 500, replyBottom: 830, scrollHeight: 1300 });
    expect(chat.requestTop()).toBe(72 + 24);
  });

  it('keeps the end of a long reply above the floating composer', () => {
    const chat = openChat({ turnTop: 500, replyBottom: 1200, scrollHeight: 1466 });
    expect(chat.replyBottom()).toBe(72 + 636 - 146 - 24);
  });
});
