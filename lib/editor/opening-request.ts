import { z } from 'zod';
import { EDITOR_MODELS, EDITOR_REASONING_EFFORTS } from '@/lib/ai/claude-model';
import { editorEditModePreferenceSchema } from '@/lib/ai/edit-mode';

const openingRequestOptionsSchema = z.object({
  modelChoice: z.enum(EDITOR_MODELS.map(model => model.id)).optional(),
  reasoningEffort: z.enum(EDITOR_REASONING_EFFORTS).optional(),
  editMode: editorEditModePreferenceSchema.optional(),
});

export function rememberOpeningRequest(projectId: string, prompt: string, options: z.infer<typeof openingRequestOptionsSchema>) {
  sessionStorage.setItem(`revline:brief-options:${projectId}`, JSON.stringify(options));
  if (prompt) sessionStorage.setItem(`revline:brief:${projectId}`, prompt);
  try {
    if (options.modelChoice) localStorage.setItem(`revline:editor-draft:${projectId}:model`, options.modelChoice);
    if (options.reasoningEffort) sessionStorage.setItem(`revline:editor-draft:${projectId}:effort`, options.reasoningEffort);
  } catch { /* The first request still carries the choices when preference storage is unavailable. */ }
}

export function openingRequestOptions(projectId: string) {
  return openingRequestOptionsSchema.parse(JSON.parse(sessionStorage.getItem(`revline:brief-options:${projectId}`) ?? '{}'));
}
