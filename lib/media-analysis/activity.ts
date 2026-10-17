import type { VideoInspectionDiagnostic } from './video-inspection';

export const MEDIA_ACTIVITY_LABELS = {
  downloading: 'Downloading footage…',
  'preparing-analysis': 'Preparing video…',
  'sending-gemini': 'Preparing footage…',
  'preparing-gemini': 'Preparing video…',
  analyzing: 'Analyzing footage…',
  'retrying-analysis': 'Retrying analysis…',
} as const;

export type MediaTaskActivity = keyof typeof MEDIA_ACTIVITY_LABELS;
export type ReportMediaActivity = (activity: MediaTaskActivity, diagnostic?: VideoInspectionDiagnostic) => void;
