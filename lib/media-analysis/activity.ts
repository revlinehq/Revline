import type { VideoInspectionDiagnostic } from './video-inspection';

export const MEDIA_ACTIVITY_LABELS = {
  'preparing-playback': 'Preparing playback…',
  downloading: 'Preparing footage…',
  'preparing-analysis': 'Preparing video…',
  'sending-gemini': 'Preparing footage…',
  'preparing-gemini': 'Preparing video…',
  analyzing: 'Analyzing footage…',
  'retrying-analysis': 'Retrying analysis…',
} as const;

/** Workers sleep when idle, so a short wait before a task starts is normal and shows the step itself.
 * Only a task still unclaimed after this long says so, so a real stall is not silent. */
export const SLOW_START_MS = 60_000;
export const SLOW_START_LABEL = 'Starting up, this can take a minute…';

export type MediaTaskActivity = keyof typeof MEDIA_ACTIVITY_LABELS;
export type ReportMediaActivity = (activity: MediaTaskActivity, diagnostic?: VideoInspectionDiagnostic) => void;

/** Derive speech stages from measured checkpoints, including older workers. */
export function mediaTaskActivityLabel(task: { kind: string; progress: number; status?: string; activity?: MediaTaskActivity }) {
  if (task.kind === 'transcribe') {
    if (task.status === 'retrying' || task.activity === 'retrying-analysis') return 'Retrying speech transcription…';
    if (task.activity === 'downloading') return 'Downloading source for speech…';
    if (task.activity === 'preparing-analysis') return 'Preparing speech audio…';
    if (task.progress >= 75) return 'Measuring speech and pauses…';
    if (task.progress >= 30) return 'Transcribing speech…';
    return 'Preparing speech audio…';
  }
  return task.activity ? MEDIA_ACTIVITY_LABELS[task.activity] : 'Preparing media…';
}
