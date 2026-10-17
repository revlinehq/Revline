export const MEDIA_ACTIVITY_LABELS = {
  downloading: 'Downloading footage…',
  'sending-gemini': 'Sending to Gemini…',
  'preparing-gemini': 'Preparing video…',
  analyzing: 'Analyzing footage…',
  'retrying-analysis': 'Retrying analysis…',
} as const;

export type MediaTaskActivity = keyof typeof MEDIA_ACTIVITY_LABELS;
export type ReportMediaActivity = (activity: MediaTaskActivity) => void;
