'use client';

import { readStoredPreference, writeStoredPreference } from '@/lib/stored-preference';

/** The editor's panel layout, kept for the person in this browser across projects, reloads and sessions: whether the
 * chat, Media sidebar and timeline are open, and how wide or tall each was last. A saved value wins over the defaults;
 * the defaults (all three open) apply only to what was never saved. Stored in localStorage: no account-level
 * preference store exists, and a server read could not size the panels before the first paint. */
export type EditorLayout = {
  chat: { open: boolean; width: number };
  media: { open: boolean; width: number };
  timeline: { open: boolean; height: number };
};

const KEY = 'revline.editorLayout.v1';
export const CHAT_MIN_WIDTH = 300, CHAT_MAX_WIDTH = 600, CHAT_DEFAULT_WIDTH = 400;
/** Below this the three-column tile grid gets cramped. */
export const MEDIA_MIN_WIDTH = 360, MEDIA_MAX_WIDTH = 680;
/** The preview keeps at least this much width beside the sidebars. */
const PREVIEW_MIN_WIDTH = 420;
export const TIMELINE_DEFAULT_HEIGHT = 360, TIMELINE_MIN_HEIGHT = 160;
/** The timeline takes at most this share of the editor's height. */
export const TIMELINE_MAX_SHARE = .65;
/** The Media panel's open state before this layout record existed; dropped so everyone starts from the new defaults once. */
const LEGACY_MEDIA_KEY = 'revline-inspector-open';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const viewport = () => typeof window === 'undefined' ? { width: 1440, height: 900 } : { width: window.innerWidth, height: window.innerHeight };

/** About 380px on a 1440px window, smaller on narrower ones, never squeezing the preview. */
function defaultMediaWidth(width: number, chat: number) {
  return Math.round(clamp(width * .265, MEDIA_MIN_WIDTH, Math.min(420, width - chat - PREVIEW_MIN_WIDTH)));
}

function readSaved(): Partial<{ [K in keyof EditorLayout]: Partial<EditorLayout[K]> }> {
  try {
    const raw = readStoredPreference(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as ReturnType<typeof readSaved> : {};
  } catch { return {}; }
}

/** The layout to open with: what was saved, defaults for the rest, widths clamped to this window. */
export function readEditorLayout(): EditorLayout {
  const saved = readSaved(), { width, height } = viewport();
  const chatOpen = typeof saved.chat?.open === 'boolean' ? saved.chat.open : true;
  const chatWidth = Math.round(clamp(finite(saved.chat?.width) ? saved.chat.width : CHAT_DEFAULT_WIDTH, CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, width - MEDIA_MIN_WIDTH - PREVIEW_MIN_WIDTH)));
  const besideChat = chatOpen ? chatWidth : 0;
  const mediaWidth = Math.round(clamp(finite(saved.media?.width) ? saved.media.width : defaultMediaWidth(width, besideChat), MEDIA_MIN_WIDTH, Math.min(MEDIA_MAX_WIDTH, width - besideChat - PREVIEW_MIN_WIDTH)));
  const timelineHeight = Math.round(clamp(finite(saved.timeline?.height) ? saved.timeline.height : TIMELINE_DEFAULT_HEIGHT, TIMELINE_MIN_HEIGHT, height * TIMELINE_MAX_SHARE));
  writeStoredPreference(LEGACY_MEDIA_KEY, null);
  return {
    chat: { open: chatOpen, width: chatWidth },
    media: { open: typeof saved.media?.open === 'boolean' ? saved.media.open : true, width: mediaWidth },
    timeline: { open: typeof saved.timeline?.open === 'boolean' ? saved.timeline.open : true, height: timelineHeight },
  };
}

/** Records one panel's change; the other panels keep what was saved for them. */
export function saveEditorLayout<K extends keyof EditorLayout>(panel: K, change: Partial<EditorLayout[K]>) {
  try {
    const saved = readSaved();
    const next = { ...saved, [panel]: { ...saved[panel], ...change } };
    if (JSON.stringify(next) !== JSON.stringify(saved)) writeStoredPreference(KEY, JSON.stringify(next));
  } catch { /* Storage unavailable: this session keeps its layout in memory. */ }
}
