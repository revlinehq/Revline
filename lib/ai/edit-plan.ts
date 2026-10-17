import { z } from 'zod';
import { TIMED_EFFECT_PRESETS } from '../editor/clip-effects';
import { TRANSITION_PRESETS } from '../editor/clip-transitions';
import { TEXT_ANIMATION_PRESETS } from '../editor/text-effects';
import { TEXT_LOOKS } from '../editor/text-looks';
import { VISUAL_EFFECT_GUIDANCE } from '../editor/effect-guidance';
import type { Clip, Timeline } from '../editor/types';

export const effectPlanInput = z.object({
  id: z.string().min(1).max(80), kind: z.enum(['timed', 'visual', 'text', 'transition']), effect: z.string().min(1).max(80),
  targetClipId: z.string().min(1).max(100).optional(), outputClipId: z.string().min(1).max(100).optional(),
  purpose: z.string().min(5).max(250), strength: z.string().min(1).max(200), expectation: z.string().min(5).max(300),
  start: z.number().min(0), duration: z.number().positive().max(3600), peak: z.number().min(0).optional(),
  anchor: z.object({ kind: z.enum(['requested-time', 'observed-event', 'marker', 'cut']), time: z.number().min(0), clipId: z.string().max(100).optional(), markerId: z.string().max(100).optional(), evidenceId: z.string().max(100).optional(), description: z.string().min(1).max(250) }),
  checks: z.object({ returnBy: z.number().min(0).optional(), minPixelChange: z.number().min(0).max(1).optional(), maxPixelChange: z.number().min(0).max(1).optional(), textSafe: z.boolean().optional(), subjectReadable: z.boolean().optional() }).optional(),
});
export type EffectPlan = z.infer<typeof effectPlanInput>;
export type EffectEvidence = { clipIds: string[]; start: number; end: number };

export function validateEffectPlan(plans: EffectPlan[], timeline: Timeline, evidence: ReadonlyMap<string, EffectEvidence> = new Map()) {
  if (!plans.length || plans.length > 8 || new Set(plans.map(plan => plan.id)).size !== plans.length) throw new Error('Plan one to eight effects with unique IDs.');
  const tolerance = 1 / timeline.fps;
  for (const plan of plans) {
    effectPlanInput.parse(plan);
    const presets = plan.kind === 'timed' ? TIMED_EFFECT_PRESETS : plan.kind === 'transition' ? TRANSITION_PRESETS : plan.kind === 'visual' ? [...Object.keys(VISUAL_EFFECT_GUIDANCE), 'motion'] : [...TEXT_ANIMATION_PRESETS, ...TEXT_LOOKS.map(look => look.id), 'appearance', 'stroke', 'shadow', 'glow'];
    if (!(presets as readonly string[]).includes(plan.effect)) throw new Error('Plan a supported effect or text control.');
    if (plan.duration < tolerance || plan.peak !== undefined && (plan.peak < plan.start - tolerance || plan.peak > plan.start + plan.duration + tolerance)) throw new Error('The planned peak must fit its effect window.');
    if (plan.targetClipId && !timeline.clips.some(clip => clip.id === plan.targetClipId)) throw new Error('The planned target is no longer in this timeline.');
    if (plan.anchor.kind === 'marker') {
      const marker = timeline.markers?.find(marker => marker.id === plan.anchor.markerId);
      if (!marker || Math.abs(marker.time - plan.anchor.time) > tolerance) throw new Error('Read the current marker before planning its effect.');
    }
    if (plan.anchor.kind === 'cut') {
      const clip = timeline.clips.find(clip => clip.id === plan.anchor.clipId);
      if (!clip || Math.abs(clip.start + clip.duration - plan.anchor.time) > tolerance) throw new Error('Read the current cut before planning its effect.');
    }
    if (plan.anchor.kind === 'observed-event') {
      const observed = plan.anchor.evidenceId ? evidence.get(plan.anchor.evidenceId) : undefined;
      if (!observed || plan.anchor.time < observed.start - tolerance || plan.anchor.time > observed.end + tolerance || (plan.anchor.clipId && !observed.clipIds.includes(plan.anchor.clipId))) throw new Error('Inspect the retained action before using it as an observed effect anchor.');
    }
  }
}

export function checkPlanTiming(plan: EffectPlan, timeline: Timeline) {
  const clip = timeline.clips.find(clip => clip.id === (plan.outputClipId ?? plan.targetClipId));
  if (!clip) return { pass: false, reason: 'The planned target is missing.' };
  const tolerance = 1 / timeline.fps;
  if (plan.kind === 'timed' || plan.kind === 'transition') {
    const matchesEffect=clip.kind==='effect'&&clip.effectPreset===plan.effect||plan.kind==='timed'&&plan.effect==='solid-color'&&clip.kind==='solid';
    return { pass: matchesEffect && Math.abs(clip.start - plan.start) <= tolerance && Math.abs(clip.duration - plan.duration) <= tolerance, actualStart: clip.start, actualDuration: clip.duration };
  }
  return { pass: plan.start >= clip.start - tolerance && plan.start + plan.duration <= clip.start + clip.duration + tolerance, actualStart: clip.start, actualDuration: clip.duration };
}

/** Disable only the planned effect; keep current footage, source timing and unrelated effects. */
export function effectDisabledReference(timeline: Timeline, plans: EffectPlan[], originals: Clip[]): Timeline {
  let clips = timeline.clips;
  for (const plan of plans) {
    const id = plan.outputClipId ?? plan.targetClipId, original = originals.find(clip => clip.id === id);
    if (!id) throw new Error('Bind the planned effect to an actual clip before reviewing.');
    if (plan.kind === 'timed' || plan.kind === 'transition') { clips = clips.filter(clip => clip.id !== id); continue; }
    if (plan.kind==='text' && [...TEXT_ANIMATION_PRESETS,'motion'].includes(plan.effect as typeof TEXT_ANIMATION_PRESETS[number])) { clips=clips.map(clip=>clip.id===id?{...clip,animation:'none',textTemplate:undefined,textAnimationTiming:undefined,motion:undefined}:clip);continue; }
    if(plan.kind==='visual'&&plan.effect!=='motion'){clips=clips.map(clip=>{if(clip.id!==id)return clip;const group=clip[plan.effect as keyof Clip];return {...clip,[plan.effect]:group&&typeof group==='object'?{...group,enabled:false}:undefined};});continue;}
    if (!original) throw new Error('The planned clip has no effect-disabled reference.');
    const keys = plan.kind === 'visual' ? [plan.effect] : plan.kind === 'text' ? ['textTemplate', 'textStyle', 'animation', 'textAnimationTiming', 'color', 'background', 'fontSize', 'fontFamily'] : ['effectPreset', 'motion', 'zoom', 'flash', 'punch', 'shake', 'pop', 'frameShrink', 'cinematicBars', 'zoomBlur', 'solidColor', 'transition'];
    clips = clips.map(clip => clip.id === id ? { ...clip, ...Object.fromEntries(keys.map(key => [key, original[key as keyof Clip]])) } : clip);
  }
  return { ...timeline, clips };
}
