import { toolBehavior, type EditorToolName } from '@/lib/ai/tool-definitions';
import type { ChatMessage, ChatTool } from './chat-types';

type Words = readonly [working: string, done: string];

/** Plain words for the tools that carry no chat label of their own. */
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

/** A step of the run, keyed by where it ran. `plain` steps come from older conversations that stored a finished line, not a tool. */
export type RunStep = ChatTool & { key: string; plain?: boolean };
export type RunText = { key: string; text: string; streaming: boolean };
/** The run's reasoning in order: what it thought, what it said along the way, and the steps it took in between. */
export type ThoughtEntry = { key: string; kind: 'thought' | 'note'; text: string } | { key: string; kind: 'steps'; labels: string[] };
export type TurnActivity = { thought: ThoughtEntry[]; latestThought: string; steps: RunStep[]; reply: RunText[]; thinkingNow: boolean };

const plainLine = (text: string) => text.replace(/[*_#`]/g, '').split(/\n+/).map(line => line.trim()).filter(Boolean).at(-1) ?? '';

/** A turn folded for the chat: one Thought for all of its reasoning, one list of its steps, and the reply (what the
 * assistant said after its last step). `active` is whether the run is still working; a step without a result after
 * that was cut off, as was one the user's Stop ended. */
export function turnActivity(replies: readonly ChatMessage[], active: boolean): TurnActivity {
  type Part = { key: string; streaming: boolean } & ({ type: 'text' | 'thinking'; text: string } | { type: 'tools'; steps: RunStep[] });
  const parts: Part[] = [];
  for (const message of replies) {
    const blocks = message.blocks ?? [...(message.text ? [{ type: 'text' as const, text: message.text }] : []), ...(message.steps?.length ? [{ type: 'tools' as const, steps: message.steps }] : [])];
    blocks.forEach((block, index) => {
      const key = `${message.id}-${index}`, streaming = message.status === 'streaming' && index === blocks.length - 1;
      if (block.type === 'tools') parts.push({ type: 'tools', key, streaming, steps: block.steps.map((step, position) => ({ ...step, key: step.id ?? `${key}-${position}` })) });
      else if (block.text.trim()) parts.push({ type: block.type, key, streaming, text: block.text });
    });
    // Older conversations stored finished steps as lines already written for the chat.
    if (message.tools?.length) parts.push({ type: 'tools', key: `${message.id}-tools`, streaming: false, steps: message.tools.map((name, position) => ({ key: `${message.id}-tools-${position}`, name, state: 'done', plain: true })) });
  }
  const lastTools = parts.findLastIndex(part => part.type === 'tools');
  const texts = parts.flatMap((part, index) => part.type === 'text' ? [{ index, key: part.key, text: part.text, streaming: part.streaming }] : []);
  const after = texts.filter(text => text.index > lastTools);
  // A run that ends on a step (a stop, a failure) keeps the last thing the assistant said as its reply. One that ends
  // on a question has its card as the reply; what it said before belongs to the Thought.
  const asked = lastTools >= 0 && (parts[lastTools] as Extract<Part, { type: 'tools' }>).steps.some(step => step.name === 'askUser');
  const reply = after.length ? after : asked ? [] : texts.slice(-1);
  const shown = new Set(reply.map(text => text.index));
  const thought: ThoughtEntry[] = [], steps: RunStep[] = [];
  parts.forEach((part, index) => {
    if (part.type !== 'tools') {
      if (part.type === 'thinking') thought.push({ key: part.key, kind: 'thought', text: part.text });
      else if (!shown.has(index)) thought.push({ key: part.key, kind: 'note', text: part.text });
      return;
    }
    const labels: string[] = [];
    for (const saved of part.steps) {
      const state = !active && saved.state === 'running' || saved.state === 'error' && /^Stopped by the user/i.test(saved.detail ?? '') ? 'stopped' as const : saved.state;
      steps.push({ ...saved, state });
      const words = saved.plain ? saved.name : runWords(saved.name)[1];
      if (labels.at(-1) !== words) labels.push(words);
    }
    const previous = thought.at(-1);
    if (previous?.kind === 'steps') previous.labels.push(...labels.filter(label => previous.labels.at(-1) !== label));
    else thought.push({ key: part.key, kind: 'steps', labels });
  });
  // A separator marks only steps taken between two pieces of reasoning.
  while (thought[0]?.kind === 'steps') thought.shift();
  while (thought.at(-1)?.kind === 'steps') thought.pop();
  const lastThinking = parts.findLast(part => part.type === 'thinking');
  return { thought, latestThought: lastThinking?.type === 'thinking' ? plainLine(lastThinking.text) : '', steps, reply: reply.map(({ key, text, streaming }) => ({ key, text, streaming })), thinkingNow: active && parts.at(-1)?.type === 'thinking' };
}
