'use client';

import { useState } from 'react';
import { AlertCircle, Film, ImageIcon, LoaderCircle, Music2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PrimaryButton } from './primary-button';
import './footage-processing-card.css';

export type FootageProcessingFile = {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  url?: string;
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

function FilePreview({ file }: { file?: FootageProcessingFile }) {
  const [imageFailed, setImageFailed] = useState(false);
  const Icon = file?.kind === 'audio' ? Music2 : file?.kind === 'image' ? ImageIcon : Film;
  return <div className="footage-processing-preview" aria-hidden="true">
    <Icon size={25} strokeWidth={1.5} />
    {file?.kind === 'image' && file.url && !imageFailed && <img src={file.url} alt="" onError={() => setImageFailed(true)} />}
    {file && <span className="footage-processing-kind">{file.kind}</span>}
  </div>;
}

export function FootageProcessingCard({ files, phase, index, total, percent, error, onRetry, onReset, onOpen }: FootageProcessingCardProps) {
  const fileTotal = total > 0 ? total : files.length;
  const fileIndex = Math.min(Math.max(1, index), Math.max(1, fileTotal));
  const file = files[fileIndex - 1] ?? files[0];
  const progress = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const failed = phase === 'error';
  const measurable = phase === 'uploading';

  return <section className="footage-processing-card" data-phase={phase} aria-label="Footage processing">
    <FilePreview key={`${file?.id ?? 'empty'}:${file?.url ?? ''}`} file={file} />
    <div className="footage-processing-body">
      <div className="footage-processing-heading">
        {failed ? <AlertCircle size={16} aria-hidden="true" /> : <LoaderCircle className="footage-processing-spinner" size={16} aria-hidden="true" />}
        <strong role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'} aria-atomic="true">{phaseLabels[phase]}</strong>
      </div>
      {file && <p className="footage-processing-filename" title={file.name}>{file.name}</p>}
      {failed ? <>
        <p className="footage-processing-error">{error || 'Your footage could not be uploaded. You can retry without choosing the files again.'}</p>
        <div className="footage-processing-actions">
          <PrimaryButton type="button" size="compact" onClick={onRetry}><RotateCcw size={13} aria-hidden="true" />Retry</PrimaryButton>
          {onOpen && <Button type="button" variant="outline" size="sm" onClick={onOpen}>Open editor</Button>}
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>Start over</Button>
        </div>
      </> : <>
        <div className="footage-processing-progress" role="progressbar" aria-label={measurable ? `Uploading ${file?.name ?? 'footage'}` : phaseLabels[phase]} aria-valuemin={measurable ? 0 : undefined} aria-valuemax={measurable ? 100 : undefined} aria-valuenow={measurable ? Math.round(progress) : undefined} data-measurable={measurable}>
          <span style={measurable ? { transform: `scaleX(${progress / 100})` } : undefined} />
        </div>
        <div className="footage-processing-meta">
          <span>{fileTotal > 0 ? `${fileIndex} of ${fileTotal} ${fileTotal === 1 ? 'file' : 'files'}` : 'Getting ready'}</span>
          <span>{measurable ? `${Math.round(progress)}%` : phase === 'opening' ? 'Ready' : 'Please keep this page open'}</span>
        </div>
      </>}
    </div>
  </section>;
}
