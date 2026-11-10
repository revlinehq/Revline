import { z } from 'zod';
import type { Id } from '@/convex/_generated/dataModel';
import { ASPECT_RATIOS, type AspectRatio } from './types';

// The new-project page hands its brief, format, footage and model choices to the
// editor through browser storage. Every key that handoff uses is spelled here.

const NEXT_BRIEF_KEY = 'revline:next-brief';
const NEXT_ASPECT_RATIO_KEY = 'revline:next-aspect-ratio';
const NEXT_CLOUD_FOOTAGE_KEY = 'revline:next-cloud-footage';
const NEXT_LINK_IMPORTS_KEY = 'revline:next-link-imports';
/** Points at the IndexedDB record holding footage staged before sign-in. */
export const FOOTAGE_DRAFT_KEY = 'revline:footage-draft';
const briefKey = (projectId: string) => `revline:brief:${projectId}`;
const briefReferenceKey = (projectId: string) => `revline:brief-reference:${projectId}`;
const briefOptionsKey = (projectId: string) => `revline:brief-options:${projectId}`;

/** The editor's composer draft for one project; model and effort choices hang off it. */
export const editorDraftKey = (projectId: string) => `revline:editor-draft:${projectId}`;
/** The new-project composer's draft for one signed-in user. */
export const newProjectComposerKey = (userId: string) => `revline:next-composer:${userId}`;

// Model choices persist across visits; effort lasts for the browser session.
export const storedDraftModel = (draftKey: string) => localStorage.getItem(`${draftKey}:model`);
export const storeDraftModel = (draftKey: string, value: string) => localStorage.setItem(`${draftKey}:model`, value);
export const storedDraftEffort = (draftKey: string) => sessionStorage.getItem(`${draftKey}:effort`);
export const storeDraftEffort = (draftKey: string, value: string) => sessionStorage.setItem(`${draftKey}:effort`, value);
// The draft text itself lasts for the browser session. Both throw when storage is unavailable.
export const storedDraftText = (draftKey: string) => sessionStorage.getItem(draftKey) ?? '';
export const storeDraftText = (draftKey: string, value: string) => sessionStorage.setItem(draftKey, value);

// New-project draft. Readers and writers throw when storage is unavailable; callers decide the fallback.
export const newProjectBrief = () => sessionStorage.getItem(NEXT_BRIEF_KEY) ?? '';
export function saveNewProjectBrief(value: string) {
  if (value) sessionStorage.setItem(NEXT_BRIEF_KEY, value); else sessionStorage.removeItem(NEXT_BRIEF_KEY);
}
export function newProjectAspectRatio(): AspectRatio | undefined {
  const saved = sessionStorage.getItem(NEXT_ASPECT_RATIO_KEY);
  return ASPECT_RATIOS.find(ratio => ratio === saved);
}
export const saveNewProjectAspectRatio = (value: AspectRatio) => sessionStorage.setItem(NEXT_ASPECT_RATIO_KEY, value);
/** Saved uploads chosen for the next project, or undefined when nothing valid is stored. */
export function newProjectCloudFootage(): Id<'assets'>[] | undefined {
  const saved: unknown = JSON.parse(sessionStorage.getItem(NEXT_CLOUD_FOOTAGE_KEY) ?? '[]');
  if (Array.isArray(saved) && saved.length <= 200 && saved.every(id => typeof id === 'string' && /^[a-z0-9]{32}$/.test(id))) return saved;
}
export function saveNewProjectCloudFootage(ids: readonly string[]) {
  if (ids.length) sessionStorage.setItem(NEXT_CLOUD_FOOTAGE_KEY, JSON.stringify(ids)); else sessionStorage.removeItem(NEXT_CLOUD_FOOTAGE_KEY);
}
/** Link-imported footage waits in a holding project until the edit starts: asset id -> that project's id. */
export function newProjectLinkImports(): Record<string, Id<'projects'>> {
  const saved: unknown = JSON.parse(sessionStorage.getItem(NEXT_LINK_IMPORTS_KEY) ?? '{}');
  const valid = (id: unknown) => typeof id === 'string' && /^[a-z0-9]{32}$/.test(id);
  return saved && typeof saved === 'object' && !Array.isArray(saved) && Object.entries(saved).every(([asset, project]) => valid(asset) && valid(project)) ? saved as Record<string, Id<'projects'>> : {};
}
export function saveNewProjectLinkImports(holders: Record<string, string>) {
  if (Object.keys(holders).length) sessionStorage.setItem(NEXT_LINK_IMPORTS_KEY, JSON.stringify(holders)); else sessionStorage.removeItem(NEXT_LINK_IMPORTS_KEY);
}
/** A project took the brief and footage; the chosen format stays for the next one. */
export function clearNewProjectSources() {
  sessionStorage.removeItem(NEXT_LINK_IMPORTS_KEY);
  sessionStorage.removeItem(NEXT_BRIEF_KEY);
  sessionStorage.removeItem(NEXT_CLOUD_FOOTAGE_KEY);
}
/** Starting over discards the whole new-project draft. */
export function clearNewProjectDraft() {
  clearNewProjectSources();
  sessionStorage.removeItem(NEXT_ASPECT_RATIO_KEY);
}

type OpeningRequestOptions = { modelChoice?: string; reasoningEffort?: string };

export function rememberOpeningRequest(projectId: string, prompt: string, options: OpeningRequestOptions) {
  sessionStorage.setItem(briefOptionsKey(projectId), JSON.stringify(options));
  if (prompt) sessionStorage.setItem(briefKey(projectId), prompt);
  try {
    if (options.modelChoice) storeDraftModel(editorDraftKey(projectId), options.modelChoice);
    if (options.reasoningEffort) storeDraftEffort(editorDraftKey(projectId), options.reasoningEffort);
  } catch { /* The first request still carries the choices when preference storage is unavailable. */ }
}
/** The brief goes out with the imported media attached instead of placed on the timeline. */
export const rememberOpeningReference = (projectId: string) => sessionStorage.setItem(briefReferenceKey(projectId), '1');

export function openingBrief(projectId: string) {
  return { prompt: sessionStorage.getItem(briefKey(projectId)), reference: sessionStorage.getItem(briefReferenceKey(projectId)) === '1' };
}
export function clearOpeningBrief(projectId: string) {
  sessionStorage.removeItem(briefKey(projectId));
  sessionStorage.removeItem(briefReferenceKey(projectId));
}

/** The caller supplies the choices it accepts, so the editor model stays independent of the AI catalog. */
export function openingRequestOptions<M extends string, E extends string>(projectId: string, choices: { models: readonly M[]; efforts: readonly E[] }) {
  // Options saved before the editing-mode picker was retired may still hold editMode; z.object drops unknown keys, so they keep parsing.
  const schema = z.object({ modelChoice: z.enum(choices.models).optional(), reasoningEffort: z.enum(choices.efforts).optional() });
  return schema.parse(JSON.parse(sessionStorage.getItem(briefOptionsKey(projectId)) ?? '{}'));
}
export const clearOpeningRequestOptions = (projectId: string) => sessionStorage.removeItem(briefOptionsKey(projectId));
