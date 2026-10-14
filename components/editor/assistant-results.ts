import { normalizeTimeline, type Timeline } from '@/lib/editor/types';

export type ChatTool = { id?: string; name: string; state: 'running' | 'done' | 'error'; detail?: string; staged?: boolean; output?: Record<string, unknown> };
export type ResultCard = { key: string; title: string; detail?: string; state: ChatTool['state']; staged?: boolean };
export const chatMessageKey = (message: { id: string; key?: string }) => message.key ?? message.id;
export type AssistantEditSnapshot = { before:Timeline;after:Timeline;revision:number;canUndo:boolean;publishedDraft:boolean };
export type SavedEditComparison = { before:Timeline;after:Timeline;revision:number;canUndo:boolean;publishedRevision?:number };
export function matchesUndoSnapshot(snapshot:Pick<AssistantEditSnapshot,'before'|'after'>,current:Timeline,previous?:Timeline){
  return !!previous&&JSON.stringify(normalizeTimeline(current))===JSON.stringify(normalizeTimeline(snapshot.after))&&JSON.stringify(normalizeTimeline(previous))===JSON.stringify(normalizeTimeline(snapshot.before));
}

/** A tool revision must match the saved snapshot before a turn can claim its difference. */
export function savedEditComparison(steps:ChatTool[],snapshot?:AssistantEditSnapshot):SavedEditComparison|null {
  if(!snapshot)return null;
  const done=steps.filter(step=>step.state==='done'&&!inspections.has(step.name));
  const saved=done.flatMap(step=>step.output?.saved===true&&typeof step.output.revision==='number'?[step.output.revision]:[]);
  const staged=done.flatMap(step=>(step.staged||step.output?.staged===true)&&typeof step.output?.revision==='number'?[step.output.revision]:[]);
  const published=snapshot.publishedDraft&&staged.length>0&&Math.max(...staged)+1===snapshot.revision;
  if(!published&&(!saved.length||Math.max(...saved)!==snapshot.revision))return null;
  const before=normalizeTimeline(snapshot.before),after=normalizeTimeline(snapshot.after);
  if(JSON.stringify(before)===JSON.stringify(after))return null;
  return {before,after,revision:snapshot.revision,canUndo:snapshot.canUndo,...(published?{publishedRevision:snapshot.revision}:{})};
}

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const errorMessage = (value: unknown) => typeof value === 'string' ? value : typeof record(value)?.message === 'string' ? String(record(value)!.message) : 'This step could not finish.';
function unpack(value: unknown): { output?: Record<string, unknown>; error?: string } {
  const wrapped = record(value);
  if (wrapped && (wrapped.type === 'error-text' || wrapped.type === 'error-json')) return { error: errorMessage(wrapped.value) };
  if (wrapped && (wrapped.type === 'json' || wrapped.type === 'text')) return unpack(wrapped.value);
  if (typeof value === 'string') {
    try { return unpack(JSON.parse(value)); } catch { return { error: value || 'This step could not finish.' }; }
  }
  if (wrapped?.error || wrapped?.isError === true || wrapped?.success === false) return { error: errorMessage(wrapped.error ?? wrapped) };
  return { output: wrapped };
}

/** Stored Agent error-text results can arrive as output-available; that is not success. */
export function chatToolFromPart(value: unknown): ChatTool | null {
  const part = record(value);
  if (!part || typeof part.type !== 'string' || !part.type.startsWith('tool-') || typeof part.state !== 'string') return null;
  const { output, error } = unpack(part.output);
  const failed = part.state === 'output-error' || part.state === 'output-denied' || !!part.errorText || !!error || (part.state === 'output-available' && !output);
  return { id: typeof part.toolCallId === 'string' ? part.toolCallId : undefined, name: part.type.slice(5), state: failed ? 'error' : part.state === 'output-available' ? 'done' : 'running', staged: output?.staged === true, output, ...(failed ? { detail: String(part.errorText || error || 'This step could not finish.').slice(0, 240) } : {}) };
}

const labels: Record<string, [string, string]> = {
  markMusicBeats: ['Marking beats', 'Marked beats'], removeMarker: ['Removing marker', 'Removed marker'], removeMarkers: ['Removing markers', 'Removed markers'], delete: ['Removing clips', 'Removed clips'], addSubtitlesFromTranscript: ['Adding subtitles', 'Added subtitles'],
  split: ['Splitting clips', 'Split clips'], trim: ['Trimming footage', 'Trimmed footage'], move: ['Arranging clips', 'Arranged clips'], addMedia: ['Adding footage', 'Added footage'],
  addCaption: ['Adding captions', 'Added captions'], addGraphic: ['Adding titles', 'Added titles'], editText: ['Updating text', 'Updated text'], styleCaptions: ['Styling captions', 'Styled captions'], styleTextClip: ['Styling text', 'Styled text'],
  applyTextLook: ['Applying text style', 'Styled text'], setTextStyle: ['Styling text', 'Styled text'], setTextAnimation: ['Animating text', 'Animated text'], configureTextTemplate: ['Adjusting text animation', 'Adjusted text animation'],
  setCaptionTiming: ['Adjusting subtitle timing', 'Adjusted subtitle timing'], applyCaptionStyle: ['Styling captions', 'Styled captions'], configureAudio: ['Adjusting sound', 'Adjusted sound'],
  addClipTransition: ['Adding transition', 'Added transition'], configureClipTransition: ['Adjusting transition', 'Adjusted transition'], configureTimedEffect: ['Adjusting effect', 'Adjusted effect'], setSolidColor: ['Adjusting color rectangle', 'Adjusted color rectangle'], resetVisualEffect: ['Resetting effect', 'Reset effect'],
  addMarker: ['Adding marker', 'Added marker'], moveMarker: ['Moving marker', 'Moved marker'],
  undoLatestEdit: ['Reverting latest edit', 'Reverted latest edit'], unlink: ['Unlinking video and audio', 'Unlinked video and audio'], duplicateClips: ['Duplicating clips', 'Duplicated clips'],
  reorderLayer: ['Reordering track', 'Reordered track'], moveClips: ['Arranging clips', 'Arranged clips'], resizeClips: ['Trimming clips', 'Trimmed clips'], setBlendMode: ['Adjusting compositing', 'Adjusted compositing'],
  transformClip: ['Adjusting framing', 'Adjusted framing'], cropClip: ['Cropping footage', 'Cropped footage'], resetVisual: ['Resetting framing', 'Reset framing'], fitClip: ['Fitting footage', 'Fitted footage'],
  setVolume: ['Adjusting sound', 'Adjusted sound'], setAspectRatio: ['Resizing canvas', 'Resized canvas'], followSubject: ['Following subject', 'Applied subject tracking'], alignCutsToBeat: ['Matching cuts to beats', 'Matched cuts to beats'],
  addLayer: ['Adding track', 'Added track'], deleteEmptyLayer: ['Removing empty track', 'Removed empty track'], removeEmptyLayers: ['Removing empty tracks', 'Removed empty tracks'],
  useStrongestMoment: ['Choosing a moment', 'Added selected moment'], applyMotionPreset: ['Animating text', 'Animated text'], animateClip: ['Animating text', 'Animated text'], setVisualEffects: ['Adjusting visual effects', 'Adjusted visual effects'],
  setPlaybackRate: ['Changing speed', 'Changed speed'], applyTextTemplate: ['Animating text', 'Animated text'], addTimedEffect: ['Adding an effect', 'Added an effect'],
  inspectTimeline: ['Checking timeline', 'Checked timeline'], inspectAssetAnalysis: ['Reading footage notes', 'Read footage notes'], analyzeMedia: ['Analyzing footage', 'Analyzed footage'], inspectVideo: ['Finding moments', 'Reviewed footage'], inspectVideoFrames: ['Inspecting frames', 'Inspected frames'],
};
const inspections = new Set(['inspectTimeline', 'inspectAssetAnalysis', 'analyzeMedia', 'inspectVideo', 'inspectVideoFrames']);
const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const noun = (n: number, singular: string, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;

/** Aggregate only successful tool evidence, with pending replacements kept distinct. */
export function summarizeTools(steps: ChatTool[], evidence:{publishedRevision?:number;draftFailed?:boolean}={}): ResultCard[] {
  const published=(output?:Record<string,unknown>)=>output?.staged===true&&typeof output.revision==='number'&&output.revision+1===evidence.publishedRevision;
  const unique = new Map<string, ChatTool>();
  steps.forEach((step, index) => unique.set(step.id ?? `${step.name}-${index}`, step));
  const groups = new Map<string, ChatTool[]>();
  for (const [id, step] of unique) {
    if (step.state === 'done' && inspections.has(step.name)) continue;
    const staged = (step.staged === true || step.output?.staged === true)&&!published(step.output);
    const savedEvidence = staged ? 'prepared' : step.output?.saved === true || step.output?.unchanged === true || published(step.output) ? 'saved' : 'unconfirmed';
    const kind = step.name === 'markMusicBeats' ? `-${step.output?.kind ?? 'beats'}` : '';
    const key = step.state === 'error' ? `${step.name}-error-${id}` : `${step.name}${kind}-${step.state}-${savedEvidence}`;
    groups.set(key, [...groups.get(key) ?? [], { ...step, staged }]);
  }
  return [...groups].map(([key, group]) => {
    const step = group[0], name = labels[step.name] ?? ['Working on your edit', 'Updated your edit'];
    if (step.state === 'error') return { key, title: 'Could not finish this step', detail: step.detail, state: step.state };
    if (step.state === 'running') return { key, title: name[0], state: step.state };
    const outputs = group.map(item => item.output ?? {});
    if (!step.staged && outputs.some(output => output.saved !== true && output.unchanged !== true&&!published(output))) return { key, title: 'Save not confirmed', detail: 'This step did not confirm a saved change.', state: 'error' };
    const changed = outputs.flatMap(output => Array.isArray(output.changedClips) ? output.changedClips.map(record).filter(Boolean) as Record<string, unknown>[] : []);
    const changedIds = new Set(changed.map(clip => clip.id).filter(isId));
    const removedIds = new Set(outputs.flatMap(output => Array.isArray(output.removedClipIds) ? output.removedClipIds.filter(isId) : []));
    let title = name[1];
    if (step.name === 'markMusicBeats' && outputs.every(output => count(output.added) !== undefined)) {
      const added = outputs.reduce((total, output) => total + count(output.added)!, 0);
      const event = step.output?.kind === 'accents' ? 'hit' : step.output?.kind === 'downbeats' ? 'bar start' : step.output?.kind === 'dropCandidates' ? 'possible drop' : 'beat';
      title = added ? `Marked ${noun(added, event)}` : `No new ${event} markers`;
    } else if ((step.name === 'removeMarker' || step.name === 'removeMarkers') && outputs.every(output => Array.isArray(output.removedMarkerIds))) {
      const markerIds = new Set(outputs.flatMap(output => (output.removedMarkerIds as unknown[]).filter(isId)));
      title = markerIds.size ? `Removed ${noun(markerIds.size, 'marker')}` : 'No markers removed';
    } else if (step.name === 'delete' && outputs.every(output => Array.isArray(output.removedClipIds))) title = removedIds.size ? `Removed ${noun(removedIds.size, 'clip')}` : 'No clips removed';
    else if ((step.name === 'addSubtitlesFromTranscript' || step.name === 'addCaption') && outputs.every(output => Array.isArray(output.changedClips))) {
      const ids = new Set(changed.filter(clip => clip.kind === 'caption').map(clip => clip.id).filter(isId));
      title = ids.size ? `Added ${noun(ids.size, 'subtitle')}` : 'No subtitles added';
    } else if (step.name === 'trim' && changedIds.size) title = `Trimmed ${noun(changedIds.size, 'clip')}`;
    else if (step.name === 'move' && changedIds.size) title = `Arranged ${noun(changedIds.size, 'clip')}`;
    const unchanged = outputs.every(output => output.unchanged === true);
    if (unchanged && !['markMusicBeats', 'removeMarker', 'removeMarkers'].includes(step.name)) title = 'No changes needed';
    const lowConfidence = outputs.some(output => output.status === 'low-confidence');
    if(step.staged&&evidence.draftFailed)return {key,title:`Not saved: ${title}`,detail:'The replacement edit was not saved.',state:'error',staged:true};
    const detail = [step.staged ? 'Awaiting save' : undefined, lowConfidence ? 'Beat detection has low confidence' : undefined].filter(Boolean).join(' · ') || undefined;
    return { key, title: step.staged && !unchanged ? `Prepared: ${title}` : title, detail, state: step.state, staged: step.staged };
  });
}
