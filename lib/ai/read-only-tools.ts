import { EDITOR_TOOL_DEFINITIONS } from './tool-definitions';

/** Tools that look at the project, the footage or the user's answers and never change the timeline. */
export const READ_ONLY_TOOLS = new Set<string>(Object.entries(EDITOR_TOOL_DEFINITIONS).filter(([, definition]) => definition.effect === 'read' || definition.effect === 'analysis').map(([name]) => name));

/** Effect plans and render reviews guard an edit's quality, so their failures still hold the turn open. */
export const isPassiveRead = (name: unknown) => typeof name === 'string' && READ_ONLY_TOOLS.has(name) && name !== 'planEffects' && name !== 'previewRender';
