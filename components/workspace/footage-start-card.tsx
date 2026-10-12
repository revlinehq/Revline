import { Plus } from 'lucide-react';

export function FootageStartCard({ onAttach, disabled, dragging }: { onAttach: () => void; disabled?: boolean; dragging?: boolean }) {
  return <button type="button" className="footage-start-card" data-dragging={dragging || undefined} onClick={onAttach} disabled={disabled}>
    <span className="footage-start-icon" aria-hidden="true"><Plus size={20} /></span>
    <strong>{dragging ? 'Drop to add your footage' : 'Drag and drop your footage'}</strong>
    <span className="footage-start-helper">Or click to choose videos, audio, or images.</span>
  </button>;
}
