import { READ_ONLY_TOOLS } from '@/lib/ai/read-only-tools';
import { toolBehavior, type EditorToolName } from '@/lib/ai/tool-definitions';
import { toolImages } from './assistant-results';
import type { ChatMessage, ChatTool } from './chat-types';

type Words = readonly [working: string, done: string];

/** Plain words for the tools that carry no chat label of their own. The chat never shows a tool's name. */
const WORDS: Partial<Record<EditorToolName, Words>> = {
  discoverCapabilities: ['Getting ready', 'Got ready'], loadCapability: ['Getting ready', 'Got ready'], switchLane: ['Getting ready', 'Got ready'],
  finish: ['Checking the result', 'Checked the result'], reportIssue: ['Noting a problem', 'Noted a problem'], recordFix: ['Noting a fix', 'Noted a fix'],
  listTimelines: ['Checking your timelines', 'Checked your timelines'], createTimeline: ['Starting a new timeline', 'Started a new timeline'], openTimeline: ['Opening a timeline', 'Opened a timeline'],
  getMediaTask: ['Waiting for media', 'Checked on media'], listRevisions: ['Checking earlier versions', 'Checked earlier versions'],
  restoreClip: ['Restoring a clip', 'Restored a clip'], restoreTimeline: ['Restoring the timeline', 'Restored the timeline'],
  readBrief: ['Reading your brief', 'Read your brief'], recallMemory: ['Recalling your preferences', 'Recalled your preferences'],
  approveClip: ['Approving a clip', 'Approved a clip'], unapproveClip: ['Reopening a clip', 'Reopened a clip'],
  detectFacecam: ['Finding the facecam', 'Found the facecam'], findHighlights: ['Finding the best moments', 'Found the best moments'],
  planClips: ['Planning clips', 'Planned clips'], checkClip: ['Checking the clip', 'Checked the clip'], finishClipping: ['Checking the clips', 'Checked the clips'],
  retainSourceRanges: ['Cutting clips', 'Cut clips'], getFrames: ['Looking at the edit', 'Looked at the edit'], checkPacing: ['Checking the pacing', 'Checked the pacing'],
  getSound: ['Listening to the sound', 'Listened to the sound'], checkSound: ['Checking the sound', 'Checked the sound'], normalizeAudio: ['Leveling the sound', 'Leveled the sound'],
  setAudioReactive: ['Syncing to the sound', 'Synced to the sound'], addSoundEffect: ['Adding a sound effect', 'Added a sound effect'],
  generateSound: ['Making a sound', 'Made a sound'], editSound: ['Editing a sound', 'Edited a sound'],
  animateEffect: ['Animating an effect', 'Animated an effect'], setMask: ['Masking footage', 'Masked footage'], setMotionBlur: ['Adding motion blur', 'Added motion blur'],
  trackPoints: ['Tracking motion', 'Tracked motion'], getTrack: ['Checking the tracking', 'Checked the tracking'], attachToTrack: ['Attaching to motion', 'Attached to motion'],
  setSpeedRamp: ['Ramping speed', 'Ramped speed'], analyzeColor: ['Reading the colors', 'Read the colors'],
  matchColor: ['Grading color', 'Graded color'], setColorCurves: ['Grading color', 'Graded color'], setHSL: ['Grading color', 'Graded color'], applyLut: ['Grading color', 'Graded color'],
  addTransition: ['Adding a transition', 'Added a transition'], addImpactFrame: ['Adding an impact frame', 'Added an impact frame'], configureImpactFrame: ['Adjusting an impact frame', 'Adjusted an impact frame'],
  addOverlay: ['Adding an overlay', 'Added an overlay'], configureOverlay: ['Adjusting an overlay', 'Adjusted an overlay'],
  freezeFrame: ['Freezing a frame', 'Froze a frame'], freezeFrameParallax: ['Adding a parallax freeze', 'Added a parallax freeze'], configureParallax: ['Adjusting parallax', 'Adjusted parallax'],
  convertSolidColorToVisual: ['Converting a color layer', 'Converted a color layer'], applyLayout: ['Arranging the layout', 'Arranged the layout'],
};

/** What a tool is doing and what it did, in plain words; an unknown tool reads by what kind of work it is. */
export function runWords(name: string): Words {
  const behavior = toolBehavior(name), own = behavior?.label ?? WORDS[name as EditorToolName];
  if (own) return own;
  if (behavior?.effect === 'read' || behavior?.effect === 'analysis') return ['Checking your project', 'Checked your project'];
  return behavior?.effect === 'timeline' ? ['Editing your timeline', 'Edited your timeline'] : ['Working', 'Finished a step'];
}

/** What the agent is doing right now, from the newest part of its reply: a running tool, thinking, or writing the reply. */
export function liveActivity(replies: readonly ChatMessage[]): { label: string } {
  const last = replies.at(-1)?.blocks?.at(-1);
  if (last?.type === 'thinking') return { label: 'Thinking' };
  if (last?.type === 'text') return { label: 'Writing the reply' };
  const step = last?.type === 'tools' ? last.steps.at(-1) : undefined;
  return { label: step?.state === 'running' ? runWords(step.name)[0] : 'Working' };
}

export type RunText = { key: string; text: string; streaming: boolean };
/** One line of what a run did: a step in plain words, or something the assistant said along the way. */
export type RunLine = { key: string; text: string; state: ChatTool['state'] | 'note'; count: number; images: { label: string; src: string }[] };
export type TurnRun = { reply: RunText[]; lines: RunLine[]; steps: number; failed: number; stopped: boolean; readOnly: boolean };

/** A turn folded for the chat: the reply is what the assistant said last (everything after its final step);
 * the steps, and what it said between them, are the run behind one summary line. Thinking is not shown. */
export function turnRun(replies: readonly ChatMessage[]): TurnRun {
  type Part = { key: string; streaming: boolean } & ({ type: 'text'; text: string } | { type: 'tools'; steps: ChatTool[]; plain?: boolean });
  const parts: Part[] = [];
  for (const message of replies) {
    const blocks = message.blocks ?? [...(message.text ? [{ type: 'text' as const, text: message.text }] : []), ...(message.steps?.length ? [{ type: 'tools' as const, steps: message.steps }] : [])];
    blocks.forEach((block, index) => {
      if (block.type === 'tools' || (block.type === 'text' && block.text.trim())) parts.push({ ...block, key: `${message.id}-${index}`, streaming: message.status === 'streaming' && index === blocks.length - 1 });
    });
    // Older conversations stored finished steps as lines already written for the chat.
    if (message.tools?.length) parts.push({ type: 'tools', key: `${message.id}-tools`, streaming: false, plain: true, steps: message.tools.map(name => ({ name, state: 'done' })) });
  }
  const lastTools = parts.findLastIndex(part => part.type === 'tools');
  const texts = parts.flatMap((part, index) => part.type === 'text' ? [{ index, key: part.key, text: part.text, streaming: part.streaming }] : []);
  const after = texts.filter(text => text.index > lastTools);
  // A run that ends on a step (a question card, a stop, a failure) keeps the last thing the assistant said as its reply.
  const reply = after.length ? after : texts.slice(-1);
  const shown = new Set(reply.map(text => text.index));
  const lines: RunLine[] = [];
  let steps = 0, failed = 0, stopped = false, readOnly = true;
  parts.forEach((part, index) => {
    if (part.type === 'text') { if (!shown.has(index)) lines.push({ key: part.key, text: part.text, state: 'note', count: 1, images: [] }); return; }
    part.steps.forEach((saved, position) => {
      // The summary is shown once the run is over: a step still without a result was cut off, as was one the user's Stop ended.
      const state = saved.state === 'running' || (saved.state === 'error' && /^Stopped by the user/i.test(saved.detail ?? '')) ? 'stopped' : saved.state, words = part.plain ? [saved.name, saved.name] as const : runWords(saved.name);
      const text = state === 'done' ? words[1] : words[0], images = toolImages(saved), previous = lines.at(-1);
      steps++; if (state === 'error') failed++; if (state === 'stopped') stopped = true; if (!READ_ONLY_TOOLS.has(saved.name)) readOnly = false;
      // The same finished step in a row reads as one line with a count and every image it returned.
      if (previous && previous.state === 'done' && state === 'done' && previous.text === text) { previous.count++; previous.images.push(...images); return; }
      lines.push({ key: `${part.key}-${position}`, text, state, count: 1, images });
    });
  });
  return { reply: reply.map(({ key, text, streaming }) => ({ key, text, streaming })), lines, steps, failed, stopped, readOnly };
}
