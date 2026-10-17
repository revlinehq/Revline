'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Scroll following for both floating and in-flow chat composers. */
export function useConversationScroll(turnId: string, enabled: boolean, overlay = true) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const opened = useRef(false);
  const previousTurn = useRef(turnId);
  const smooth = useRef(false);
  // Footer notes and composer clearance must not push the request above the viewport.
  const targetMode = useRef<'turn' | 'reply'>('turn');
  const animation = useRef<{ frame: number | null; target: number; time?: number }>({ frame: null, target: 0 });
  const historyAnchor = useRef<{ id: string; top: number; firstId?: string; height: number; scrollTop: number } | null>(null);
  const [latestHidden, setLatestHidden] = useState(false);

  const stopAnimation = useCallback(() => {
    if (animation.current.frame !== null) cancelAnimationFrame(animation.current.frame);
    animation.current.frame = null;
    animation.current.time = undefined;
  }, []);
  const pause = useCallback(() => { following.current = false; stopAnimation(); }, [stopAnimation]);
  const followBottom = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const state = animation.current;
    const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
    const turn = el.querySelector<HTMLElement>('.is-latest-turn');
    const reply = turn?.querySelector<HTMLElement>('.conversation-response:last-of-type,.chat-assistant:last-of-type');
    const tail = Array.from(el.querySelectorAll<HTMLElement>('[data-chat-follow]')).at(-1);
    const viewportTop = el.getBoundingClientRect().top;
    const replySpace = targetMode.current === 'reply' ? 160 : Math.max(80, el.clientHeight - (overlay ? composer.current?.offsetHeight ?? 0 : 0) - 24);
    const anchor = turn ? Math.max(turn.getBoundingClientRect().top - viewportTop + el.scrollTop - 24, reply ? reply.getBoundingClientRect().bottom - viewportTop + el.scrollTop - replySpace : 0) : bottom;
    const tailAnchor = tail ? tail.getBoundingClientRect().bottom - viewportTop + el.scrollTop - el.clientHeight + 16 : 0;
    state.target = Math.max(0, Math.min(bottom, Math.max(anchor, tailAnchor)));
    if (!smooth.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stopAnimation(); el.scrollTop = state.target; return;
    }
    if (state.frame !== null) return;
    const tick = (time: number) => {
      const delta = state.time === undefined ? 16 : Math.min(32, time - state.time);
      state.time = time;
      const distance = state.target - el.scrollTop;
      if (Math.abs(distance) <= 1) { el.scrollTop = state.target; state.frame = null; state.time = undefined; setLatestHidden(false); }
      else { el.scrollTop += distance * (1 - Math.exp(-delta / 55)); state.frame = requestAnimationFrame(tick); }
    };
    state.frame = requestAnimationFrame(tick);
  }, [overlay, stopAnimation]);
  const resume = useCallback(() => { historyAnchor.current = null; targetMode.current = 'turn'; following.current = true; smooth.current = true; setLatestHidden(false); followBottom(); }, [followBottom]);
  const anchorReply = useCallback(() => { if (following.current) { targetMode.current = 'reply'; followBottom(); } }, [followBottom]);
  const preserveHistory = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    pause();
    const messages = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'));
    const top = el.getBoundingClientRect().top;
    const anchor = messages.find(node => node.getBoundingClientRect().bottom >= top);
    if (anchor) historyAnchor.current = { id: anchor.dataset.messageId!, top: anchor.getBoundingClientRect().top - top, firstId: messages[0]?.dataset.messageId, height: el.scrollHeight, scrollTop: el.scrollTop };
  }, [pause]);

  useLayoutEffect(() => {
    const el = viewport.current, body = content.current, footer = composer.current;
    if (!enabled || !el || !body || !footer) return;
    let measurement: number | null = null;
    const setPixels = (target: HTMLElement | null, property: string, pixels: number) => {
      if (target && target.style.getPropertyValue(property) !== `${pixels}px`) target.style.setProperty(property, `${pixels}px`);
    };
    const measure = () => {
      setPixels(el, '--chat-viewport-height', el.clientHeight);
      setPixels(el, '--chat-composer-height', overlay ? footer.offsetHeight : 0);
      setPixels(el.parentElement, '--chat-scrollbar-width', el.offsetWidth - el.clientWidth);
      const anchor = historyAnchor.current;
      const messages = Array.from(body.querySelectorAll<HTMLElement>('[data-message-id]'));
      if (anchor && messages[0]?.dataset.messageId !== anchor.firstId) {
        const node = messages.find(message => message.dataset.messageId === anchor.id);
        if (node) el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.top;
        else el.scrollTop = anchor.scrollTop + el.scrollHeight - anchor.height;
        historyAnchor.current = null;
      }
      if (following.current && !historyAnchor.current) followBottom();
      if (animation.current.frame === null) setLatestHidden(!following.current && el.scrollHeight - el.clientHeight - el.scrollTop > 80);
    };
    const schedule = () => { if (measurement === null) measurement = requestAnimationFrame(() => { measurement = null; measure(); }); };
    const onScroll = () => {
      if (animation.current.frame !== null) return;
      if (following.current && Math.abs(el.scrollTop - animation.current.target) <= 1) return;
      const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
      following.current = distance <= 80;
      setLatestHidden(distance > 80);
    };
    const onKey = (event: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pause(); };
    const onPointer = (event: PointerEvent) => { if (event.target === el) pause(); };
    measure(); opened.current = true;
    const observer = new ResizeObserver(schedule);
    observer.observe(el); observer.observe(body); observer.observe(footer);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', pause, { passive: true });
    el.addEventListener('touchstart', pause, { passive: true });
    el.addEventListener('keydown', onKey); el.addEventListener('pointerdown', onPointer);
    return () => {
      observer.disconnect(); stopAnimation();
      if (measurement !== null) cancelAnimationFrame(measurement);
      el.removeEventListener('scroll', onScroll); el.removeEventListener('wheel', pause); el.removeEventListener('touchstart', pause); el.removeEventListener('keydown', onKey); el.removeEventListener('pointerdown', onPointer);
    };
  }, [enabled, overlay, followBottom, pause, stopAnimation]);

  useLayoutEffect(() => {
    if (previousTurn.current === turnId) return;
    previousTurn.current = turnId;
    if (opened.current) resume();
  }, [turnId, resume]);

  return { viewport, content, composer, latestHidden, pause, resume, preserveHistory, anchorReply };
}
