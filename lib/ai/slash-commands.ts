import { parseVideoLink } from '../editor/video-link';

export const EDITOR_SLASH_COMMANDS = [
  { name: 'clip', note: 'Clip a stream or video into vertical shorts' },
] as const;

export type EditorCommandName = typeof EDITOR_SLASH_COMMANDS[number]['name'];
export type EditorCommand = { name: 'clip'; link?: string; words: string };

/** Parse the explicit clipping command. All other text remains a plain prompt. */
export function parseEditorCommand(prompt: string): EditorCommand | undefined {
  const match = /^\/(clip)(?:\s+([\s\S]*))?$/.exec(prompt.trim());
  if (!match) return undefined;
  const rest = (match[2] ?? '').trim();
  const url = /(?:^|\s)(https?:\/\/\S+)/i.exec(rest);
  const link = url ? parseVideoLink(url[1]).url : undefined;
  const words = url ? rest.replace(url[1], '').trim() : rest;
  return { name: 'clip', ...(link ? { link } : {}), words };
}

export function editorCommandInstructions(command: EditorCommand) {
  const source = command.link ? `Import the full linked video once with importVideoLink: ${JSON.stringify(command.link)}. Wait for getMediaTask to complete, then inspectTimeline to refresh project sources. Reuse an already imported source on continuation.` : "Use this project's footage, prioritizing newly attached sources.";
  const workflow = 'Start the clipping workflow immediately. Find the best moments and make vertical shorts. Create one blank vertical timeline tab per clip, named after that clip\'s title. Keep unrelated tabs intact. Read the clipping pages as needed. Extra words tune the clipping criteria and finish.';
  return `# Explicit slash command\n${JSON.stringify(command)}\n${workflow}\n${source}\nAdditional direction: ${JSON.stringify(command.words || '(defaults)')}.\nDo not export. Complete the requested videos in the editor. The command's workflow takes precedence over generic intent routing. The required skill is loaded below; follow it before working.`;
}
