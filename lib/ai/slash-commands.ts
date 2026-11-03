import { parseVideoLink } from '../editor/video-link';

export const EDITOR_SLASH_COMMANDS = [
  { name: 'clip', note: 'Clip a stream or video into vertical shorts' },
  { name: 'inspo-motion', note: "Recreate a video's motion for your brand" },
] as const;

export type EditorCommandName = typeof EDITOR_SLASH_COMMANDS[number]['name'];
export type EditorCommand =
  | { name: 'clip'; link?: string; words: string }
  | { name: 'inspo-motion'; link: string; words: string };

/** Parse only the two explicit commands. All other text remains a plain prompt. */
export function parseEditorCommand(prompt: string): EditorCommand | undefined {
  const match = /^\/(clip|inspo-motion)(?:\s+([\s\S]*))?$/.exec(prompt.trim());
  if (!match) return undefined;
  const rest = (match[2] ?? '').trim();
  const url = /(?:^|\s)(https?:\/\/\S+)/i.exec(rest);
  const link = url ? parseVideoLink(url[1]).url : undefined;
  const words = url ? rest.replace(url[1], '').trim() : rest;
  if (match[1] === 'inspo-motion') {
    if (!link) throw new Error('Add a video link after /inspo-motion.');
    return { name: 'inspo-motion', link, words };
  }
  return { name: 'clip', ...(link ? { link } : {}), words };
}

export function editorCommandInstructions(command: EditorCommand) {
  const source = command.link ? `Import the full linked video once with importVideoLink: ${JSON.stringify(command.link)}. Wait for getMediaTask to complete, then inspectTimeline to refresh project sources. Reuse an already imported source on continuation.` : "Use this project's footage, prioritizing newly attached sources.";
  const workflow = command.name === 'clip'
    ? 'Start the clipping workflow immediately. Call findHighlights once with delivery clips, review its top candidates and persist planClips. Default to the length-scaled recommended count without padding. Build every accepted candidate; checkClip each tab and finishClipping before reporting its exact delivered tab list. Create one blank vertical timeline tab per clip, named after that clip\'s title. Keep unrelated tabs intact. Read the clipping pages as needed. Extra words tune the clipping criteria and finish.'
    : 'Start the reference-footage recreation workflow (Sharingan) immediately. Keep the linked reference off the timeline. Recreate its motion, timing and transitions for the user\'s brand kit, using the kit\'s colors, fonts, logo and confirmed brand/product content in place of reference branding. Inspect available brand kits and ask only if the intended kit cannot be determined. This brand adaptation overrides the recreation page\'s default of copying visible reference branding and words.';
  return `# Explicit slash command\n${JSON.stringify(command)}\n${workflow}\n${source}\nAdditional direction: ${JSON.stringify(command.words || '(defaults)')}.\nDo not export. Complete the requested videos in the editor. The command's workflow takes precedence over generic intent routing. The required skill is loaded below; follow it before working.`;
}
