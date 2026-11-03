'use client';

import { RotateCcw } from 'lucide-react';
import { FootagePreparation } from '@/components/editor/footage-preparation';
import { Button } from '@/components/ui/button';
import { PrimaryButton } from './primary-button';
import './footage-processing-card.css';

export type FootageProcessingFile = {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio' | 'model';
  url?: string;
  thumbnail?: string;
};

export type FootageProcessingPhase = 'connecting' | 'preparing' | 'reading' | 'uploading' | 'saving' | 'processing' | 'watching' | 'listening' | 'opening' | 'error';

type FootageProcessingCardProps = {
  progressKey?: string;
  files: FootageProcessingFile[];
  phase: FootageProcessingPhase;
  index: number;
  total: number;
  percent: number;
  activity?: string;
  error?: string;
  onRetry: () => void;
  onReset: () => void;
  onOpen?: () => void;
};

const phaseLabels: Record<FootageProcessingPhase, string> = {
  connecting: 'Connecting to your workspace',
  preparing: 'Preparing your project',
  reading: 'Reading your media',
  uploading: 'Uploading your footage',
  saving: 'Saving your project',
  opening: 'Opening your editor',
  processing: 'Preparing your footage',
  watching: 'Watching your footage',
  listening: 'Listening to your footage',
  error: 'Your upload needs attention',
};

export function FootageProcessingCard({ progressKey, files, phase, index, total, percent, activity: stageActivity, error, onRetry, onReset, onOpen }: FootageProcessingCardProps) {
  const fileTotal = total > 0 ? total : files.length;
  const fileIndex = Math.min(Math.max(1, index), Math.max(1, fileTotal));
  const file = files[fileIndex - 1] ?? files[0];
  const progress = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const failed = phase === 'error';
  const transferring = ['connecting', 'preparing', 'reading', 'uploading'].includes(phase);
  const label = stageActivity || (phase === 'uploading' ? 'Uploading footage…' : phaseLabels[phase] + '…');

  const activity = fileTotal > 1 ? `Clip ${fileIndex} of ${fileTotal}` : undefined;
  return <FootagePreparation progressKey={progressKey} progress={progress} thumbnail={file?.thumbnail || (file?.kind === 'image' ? file.url : undefined)} fileName={file?.name} activity={activity} label={label} detail={transferring?'Sending your files to your project.':undefined} error={failed ? error || 'Your footage could not be prepared. Retry without choosing the files again.' : undefined}>
    {failed && <div className="footage-processing-actions">
      <PrimaryButton type="button" size="compact" onClick={onRetry}><RotateCcw size={13} aria-hidden="true"/>Retry</PrimaryButton>
      {onOpen && <Button type="button" variant="outline" size="sm" onClick={onOpen}>Open editor</Button>}
      <Button type="button" variant="ghost" size="sm" onClick={onReset}>Start over</Button>
    </div>}
  </FootagePreparation>;
}
