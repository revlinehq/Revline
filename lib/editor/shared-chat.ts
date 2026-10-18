/** Public conversation snapshots contain text only: no agent records or metadata. */
export type SharedChatMessage = { role: 'user' | 'assistant'; text: string };
export type ShareChatPreviewMessage = SharedChatMessage & { id: string };
export type ShareChatPreview = { messages: ShareChatPreviewMessage[]; truncated: boolean };
export const SHARED_CHAT_LIMITS = { scanned: 120, messages: 40, messageCharacters: 4_000, characters: 32_000 } as const;
