'use client';

import { RotateCcw } from 'lucide-react';
import { FootagePreparation } from '@/components/editor/footage-preparation';
import { Button } from '@/components/ui/button';
import { PrimaryButton } from './primary-button';
import './footage-processing-card.css';

export type FootageProcessingFile = {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  url?: string;
  thumbnail?: string;
};

export type FootageProcessingPhase = 'connecting' | 'preparing' | 'reading' | 'uploading' | 'saving' | 'opening' | 'error';

type FootageProcessingCardProps = {
  files: FootageProcessingFile[];
  phase: FootageProcessingPhase;
  index: number;
  total: number;
  percent: number;
  error?: string;
  onRetry: () => void;
  onReset: () => void;
  onOpen?: () => void;
};

const phaseLabels: Record<FootageProcessingPhase, string> = {
  connecting: 'Connecting to your workspace',
  preparing: 'Creating your project',
  reading: 'Reading your media',
  uploading: 'Uploading your footage',
  saving: 'Saving your project',
  opening: 'Opening your editor',
  error: 'Your upload needs attention',
};

export function FootageProcessingCard({ files, phase, index, total, percent, error, onRetry, onReset, onOpen }: FootageProcessingCardProps) {
  const fileTotal = total > 0 ? total : files.length;
  const fileIndex = Math.min(Math.max(1, index), Math.max(1, fileTotal));
  const file = files[fileIndex - 1] ?? files[0];
  const progress = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const failed = phase === 'error';
  const measurable = phase === 'uploading';

  const activity = measurable ? `Uploading clip ${fileIndex} of ${fileTotal} · ${Math.round(progress)}%` : phase === 'opening' ? undefined : `${phaseLabels[phase]}${fileTotal > 1 ? ` · ${fileIndex} of ${fileTotal}` : ''}`;
  return <FootagePreparation thumbnail={file?.thumbnail || (file?.kind === 'image' ? file.url : undefined)} fileName={file?.name} activity={activity} error={failed ? error || 'Your footage could not be uploaded. Retry without choosing the files again.' : undefined}>
    {failed && <div className="footage-processing-actions">
      <PrimaryButton type="button" size="compact" onClick={onRetry}><RotateCcw size={13} aria-hidden="true"/>Retry</PrimaryButton>
      {onOpen && <Button type="button" variant="outline" size="sm" onClick={onOpen}>Open editor</Button>}
      <Button type="button" variant="ghost" size="sm" onClick={onReset}>Start over</Button>
    </div>}
  </FootagePreparation>;
}
