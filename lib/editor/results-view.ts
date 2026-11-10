/** Where a finished edit is shown after a message from the AI Editor start page: in the chat, or straight in the full editor. */
export type ResultsView = 'chat' | 'timeline';
/** Kept per user in this browser, like the composer's model choice. */
export const resultsViewKey = (userId: string | null | undefined) => `revline:results-view:${userId ?? 'anonymous'}`;
export const decodeResultsView = (stored: string | null): ResultsView => stored === 'timeline' ? 'timeline' : 'chat';
/** The conversation view of a project, and its full editor. */
export const projectChatPath = (projectId: string) => `/chat/${encodeURIComponent(projectId)}`;
export const projectEditorPath = (projectId: string) => `/editor/${encodeURIComponent(projectId)}`;
export const projectPath = (projectId: string, view: ResultsView) => view === 'timeline' ? projectEditorPath(projectId) : projectChatPath(projectId);
