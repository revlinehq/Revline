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

export type MediaTaskActivity = keyof typeof MEDIA_ACTIVITY_LABELS;
export type ReportMediaActivity = (activity: MediaTaskActivity, diagnostic?: VideoInspectionDiagnostic) => void;

/** Derive speech stages from measured checkpoints, including older workers. */
export function mediaTaskActivityLabel(task: { kind: string; progress: number; status?: string; activity?: MediaTaskActivity }) {
  if (task.kind === 'transcribe') {
    if (task.status === 'queued') return 'Queued for speech transcription…';
    if (task.status === 'retrying' || task.activity === 'retrying-analysis') return 'Retrying speech transcription…';
    if (task.progress >= 75) return 'Measuring speech and pauses…';
    if (task.progress >= 30) return 'Transcribing speech…';
    return task.activity === 'downloading' ? 'Downloading source for speech…' : 'Preparing speech audio…';
  }
  return task.activity ? MEDIA_ACTIVITY_LABELS[task.activity] : 'Preparing media…';
}
