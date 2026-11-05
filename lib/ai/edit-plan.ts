import { z } from 'zod';
import { TIMED_EFFECT_PRESETS, TRANSITION_PRESETS } from '../editor/types';
import { TEXT_ANIMATION_PRESETS } from '../editor/text-effects';
import { TEXT_LOOKS } from '../editor/text-looks';
import { VISUAL_EFFECT_GUIDANCE } from '../editor/effect-guidance';
import type { Clip, Timeline } from '../editor/types';
import { equalTimelineValue } from '../editor/timeline-equality';

const effectPlanFields = {
  id: z.string().min(1).max(80),
  targetClipId: z.string().min(1).max(100).optional(), outputClipId: z.string().min(1).max(100).optional(),
  purpose: z.string().min(5).max(250), strength: z.string().min(1).max(200), expectation: z.string().min(5).max(300),
  start: z.number().min(0), duration: z.number().positive().max(3600), peak: z.number().min(0).optional(),
  anchor: z.object({ kind: z.enum(['requested-time', 'observed-event', 'marker', 'cut']), time: z.number().min(0), clipId: z.string().max(100).optional(), markerId: z.string().max(100).optional(), evidenceId: z.string().max(100).optional(), description: z.string().min(1).max(250) }),
  checks: z.object({ returnBy: z.number().min(0).optional(), minPixelChange: z.number().min(0).max(1).optional(), maxPixelChange: z.number().min(0).max(1).optional(), textSafe: z.boolean().optional(), subjectReadable: z.boolean().optional() }).optional(),
};
const EFFECT_PLAN_EFFECTS = {
  timed: [...TIMED_EFFECT_PRESETS], transition: [...TRANSITION_PRESETS],
  visual: [...Object.keys(VISUAL_EFFECT_GUIDANCE), 'motion'],
  text: [...new Set([...TEXT_ANIMATION_PRESETS, ...TEXT_LOOKS.map(look => look.id), 'appearance', 'stroke', 'shadow', 'glow', 'gradient'])],
};
// A union emits JSON Schema anyOf (supported by Responses tool schemas), while
// exposing the exact effect enum for each kind before the model calls the tool.
export const effectPlanInput = z.union([
  z.object({ ...effectPlanFields, kind: z.literal('timed'), effect: z.enum(EFFECT_PLAN_EFFECTS.timed) }),
  z.object({ ...effectPlanFields, kind: z.literal('transition'), effect: z.enum(EFFECT_PLAN_EFFECTS.transition) }),
  z.object({ ...effectPlanFields, kind: z.literal('visual'), effect: z.enum(EFFECT_PLAN_EFFECTS.visual) }),
  z.object({ ...effectPlanFields, kind: z.literal('text'), effect: z.enum(EFFECT_PLAN_EFFECTS.text) }),
]);
// Persistence remains compatible with historical string values, validated at runtime.
const effectPlanBase = z.object(effectPlanFields);
export type EffectPlan = z.infer<typeof effectPlanBase> & { kind: 'timed' | 'visual' | 'text' | 'transition'; effect: string };
export type EffectEvidence = { clipIds: string[]; start: number; end: number };

/** Planning another effect must not erase earlier expectations or output links.
 * Freeze only expectations that actually entered a rendered review. */
export function mergeEffectPlans(previous:EffectPlan[],incoming:EffectPlan[],lockedIds:ReadonlySet<string>=new Set()):EffectPlan[]{
  if(!incoming.length||new Set(incoming.map(plan=>plan.id)).size!==incoming.length)throw new Error('Plan one to eight effects with unique IDs.');
  const merged=new Map(previous.map(plan=>[plan.id,plan]));
  for(const plan of incoming){
    if(lockedIds.has(plan.id)&&!equalTimelineValue(merged.get(plan.id),plan))throw new Error('Keep the original expectations after review; adjust the edit once.');
    merged.set(plan.id,plan);
  }
  if(merged.size>8)throw new Error('Keep at most eight effect expectations per run; update an existing unreviewed plan by its ID.');
  return [...merged.values()];
}

/** Output selection is review metadata, not a reason to rewrite expectations.
 * One timed expectation describes one actual FX clip, never a pulse group. */
export function effectReviewBindings(plans:EffectPlan[],timeline:Timeline,bindings:readonly {planId:string;clipId:string}[]=[]){
  if(new Set(bindings.map(binding=>binding.planId)).size!==bindings.length||bindings.some(binding=>!plans.some(plan=>plan.id===binding.planId)))throw new Error('Bind each selected review plan at most once.');
  return plans.map(plan=>{
    const timed=plan.kind==='timed'||plan.kind==='transition';
    let clipId=bindings.find(binding=>binding.planId===plan.id)?.clipId??plan.outputClipId??(timed?undefined:plan.targetClipId);
    if(!clipId&&timed){
      const matches=timeline.clips.filter(clip=>checkPlanTiming({...plan,outputClipId:clip.id},timeline).pass);
      if(matches.length===1)clipId=matches[0].id;
    }
    const clip=timeline.clips.find(clip=>clip.id===clipId);
    if(!clip)throw new Error('Identify the actual planned output clip before review. Pass its clip ID in previewRender bindings; keep the effect plan unchanged.');
    if(!timed&&(plan.outputClipId??plan.targetClipId)&&clip.id!==(plan.outputClipId??plan.targetClipId))throw new Error('Review the planned target clip; a different object cannot verify this expectation.');
    if(timed&&!checkPlanTiming({...plan,outputClipId:clip.id},timeline).pass)throw new Error(clip.kind==='effect'
      ?'A timed review plan must match one FX clip and its full range. Use a separate plan for each pulse.'
      :`Plan kind ${plan.kind} reviews an FX clip, but ${clip.id} is a ${clip.kind} clip. Re-plan this expectation with kind visual and targetClipId ${clip.id}, keeping its wording and window.`);
    if(plan.kind==='text'&&clip.kind!=='caption'&&clip.kind!=='graphic')throw new Error('Bind a text review to its actual text clip.');
    if(plan.kind==='visual'&&plan.effect!=='motion'&&clip.kind!=='video'&&clip.kind!=='image')throw new Error('Bind a footage effect review to its actual video or image clip.');
    return {planId:plan.id,clipId:clip.id};
  });
}

/** Correcting a plan's review window must not turn the edited draft into its
 * own reference. Keep the first snapshot for each still-planned target. */
export function preservePlanOriginals(originals: Clip[], previous: Clip[] = []): Clip[] {
  const first = new Map(previous.map(clip => [clip.id, clip]));
  return originals.map(clip => first.get(clip.id) ?? clip);
}

export function validateEffectPlan(plans: EffectPlan[], timeline: Timeline, evidence: ReadonlyMap<string, EffectEvidence> = new Map()) {
  if (!plans.length || plans.length > 8 || new Set(plans.map(plan => plan.id)).size !== plans.length) throw new Error('Plan one to eight effects with unique IDs.');
  const tolerance = 1 / timeline.fps;
  for (const plan of plans) {
    if(!effectPlanInput.safeParse(plan).success)throw new Error('Plan needs valid fields and a supported effect or text control.');
    if (plan.duration < tolerance || plan.peak !== undefined && (plan.peak < plan.start - tolerance || plan.peak > plan.start + plan.duration + tolerance)) throw new Error('The planned peak must fit its effect window.');
    if (plan.targetClipId && !timeline.clips.some(clip => clip.id === plan.targetClipId)) throw new Error('The planned target is no longer in this timeline.');
    if ([plan.targetClipId, plan.anchor.kind === 'cut' ? plan.anchor.clipId : undefined].some(id => id && timeline.clips.find(clip => clip.id === id)?.kind === 'scene')) throw new Error('Scenes are verified by their code, not planned as effects. Edit the scene with editScene; no planEffects or previewRender is needed.');
    if (plan.anchor.kind === 'marker') {
      const marker = timeline.markers?.find(marker => marker.id === plan.anchor.markerId);
      if (!marker || Math.abs(marker.time - plan.anchor.time) > tolerance) throw new Error('Read the current marker before planning its effect.');
    }
    if (plan.anchor.kind === 'cut') {
      // Either side of a cut names it: the clip ending there or the one starting there.
      const clip = timeline.clips.find(clip => clip.id === plan.anchor.clipId);
      if (!clip) throw new Error(`The cut anchor clip ${plan.anchor.clipId} is not in the current timeline.`);
      if (Math.abs(clip.start + clip.duration - plan.anchor.time) > tolerance && Math.abs(clip.start - plan.anchor.time) > tolerance) throw new Error(`Clip ${clip.id} spans ${clip.start.toFixed(3)}–${(clip.start + clip.duration).toFixed(3)}s, so it does not end or start at the anchored cut ${plan.anchor.time.toFixed(3)}s. Anchor the cut with a clip that ends or starts there.`);
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
    if(plan.kind==='visual'&&plan.effect==='motion'){
      // This is an effect-disabled comparison, not a copy of an older zoom.
      // Rechecking an already-saved zoom must also compare against neutral keys.
      clips=clips.map(clip=>clip.id===id?{...clip,motion:undefined,motionOffset:undefined,smoothZoom:undefined,cameraMotion:undefined}:clip);continue;
    }
    if(plan.kind==='visual'&&plan.effect!=='motion'){clips=clips.map(clip=>{if(clip.id!==id)return clip;const group=clip[plan.effect as keyof Clip];return {...clip,[plan.effect]:group&&typeof group==='object'?{...group,enabled:false}:undefined};});continue;}
    if(plan.kind==='text'&&plan.effect==='gradient'){clips=clips.map(clip=>clip.id===id?{...clip,textGradient:undefined}:clip);continue;}
    if (!original) throw new Error('The planned clip has no effect-disabled reference.');
    const keys = plan.kind === 'text' ? ['textTemplate', 'textStyle', 'textGradient', 'animation', 'textAnimationTiming', 'color', 'background', 'fontSize', 'fontFamily'] : ['effectPreset', 'motion', 'zoom', 'flash', 'punch', 'shake', 'pop', 'frameShrink', 'cinematicBars', 'zoomBlur', 'solidColor', 'transition'];
    clips = clips.map(clip => clip.id === id ? { ...clip, ...Object.fromEntries(keys.map(key => [key, original[key as keyof Clip]])) } : clip);
  }
  return { ...timeline, clips };
}
