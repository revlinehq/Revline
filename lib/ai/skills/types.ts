/** A page of a long skill: the main body stays short and deeper pages load only when a job needs them. */
export type EditorSkillPage = { name: string; description: string; body: string };
/** Format-specific instructions the assistant loads on demand with readSkill. */
export type EditorSkill = { name: string; description: string; body: string; pages?: EditorSkillPage[] };
