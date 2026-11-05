/** Format-specific instructions the assistant loads on demand with readSkill. */
/** Long skills keep a short main body and load deeper pages only when a job needs them. */
export type EditorSkillPage = { name: string; description: string; body: string };
export type EditorSkill = { name: string; description: string; body: string; pages?: EditorSkillPage[] };
