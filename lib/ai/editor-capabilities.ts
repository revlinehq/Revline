import { EFFECT_LIBRARY_CATALOG, EFFECT_LIBRARY_CATEGORIES } from '../editor/effect-catalog';
import { EFFECT_CATALOG, TIMED_EFFECT_PRESETS } from '../editor/clip-effects';
import { TRANSITION_DIRECTIONS, TRANSITION_PRESETS } from '../editor/clip-transitions';
import { TEXT_ANIMATION_LABELS, TEXT_ANIMATION_PRESETS } from '../editor/text-effects';
import { TEXT_LOOKS } from '../editor/text-looks';
import { TEXT_FONTS } from '../editor/text-fonts';
import { AUDIO_ROLES } from '../editor/audio-settings';

/** Pure shared metadata: backend instructions and the UI read the same implemented inventory. */
export function editorCapabilities(){
  return {
    effects:EFFECT_LIBRARY_CATEGORIES.map(category=>({category:category.label,items:EFFECT_LIBRARY_CATALOG.filter(entry=>entry.category===category.id).map(entry=>({name:entry.label,...(entry.visual?{footageControl:entry.visual}:{}),...(entry.preset?{fxPreset:entry.preset}:{}),...(entry.action?{action:entry.action}:{})}))})),
    timedFX:TIMED_EFFECT_PRESETS.map(preset=>({preset,name:EFFECT_CATALOG[preset].label,controls:preset==='cinematic-bars'?['duration','size','entrance/exit speed']:preset==='solid-color'?['duration','color','width','height','center x/y','opacity']:preset==='zoom-blur'?['duration','enabled','amount','center x/y']:['duration']})),
    transitions:{presets:TRANSITION_PRESETS,directions:TRANSITION_DIRECTIONS,target:'Two adjacent video/image clips on the same V track with the same effective blend mode; preserve retained source range, timeline and audio timing'},
    text:{animations:TEXT_ANIMATION_PRESETS.map(preset=>({preset,name:TEXT_ANIMATION_LABELS[preset]})),looks:TEXT_LOOKS.map(look=>({id:look.id,name:look.label,appearance:{color:look.color,background:look.background,fontSize:look.fontSize,blendMode:look.blendMode,textStyle:look.style},...('animation' in look?{defaultAnimation:look.animation}:{})})),fonts:TEXT_FONTS.map(font=>({id:font.id,name:font.label})),controls:['words','font size/family','position','rotation','solid text/background/highlight colors','blend mode','stroke','shadow','glow'],combination:'Editable appearance and one selected animation are independent; advanced outer motion and Remotion template can also combine'},
    captions:{controls:['edit existing words','frame-snapped start/end with preserved animation phase','apply appearance to all or selected captions while keeping each words/timing/animation'],source:'Existing saved caption clips; transcription happens only when requested'},
    markers:{controls:['add a free cue at user-provided timeline seconds with an optional user label','move an exact marker ID to requested seconds','remove exact IDs or clear all'],source:'Frame-snapped manual cues; measured music hits use the separate beat-analysis tools'},
    audio:{roles:AUDIO_ROLES,controls:['volume0..2','fade in/out in timeline seconds','lower music under explicitly labeled audible voice clips with amount/attack/release'],ducking:'Uses voice-clip coverage, not speech detection; preserves original source/audio timing'},
    ditherPalette:'Optional shadowColor and highlightColor are six-digit hex colors; otherwise retain source RGB color',
    solidColor:'Independent FX color frame/rectangle; editable color, normalized width/height/x/y and opacity',
  };
}
