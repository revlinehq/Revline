import type { Clip } from './types';

/** Clip identity stays stable when text is added or removed ahead of decoded media. */
export function compositionNode(document: Document, clip: Pick<Clip, 'id'>, index: number): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-source-clip],[data-text-clip]')).find(node => node.dataset.sourceClip === clip.id || node.dataset.textClip === clip.id) ?? document.getElementById(`clip-${index}`);
}
export function compositionIndex(document: Document, clip: Pick<Clip, 'id'>, index: number): number {
  const match = /^clip-(\d+)$/.exec(compositionNode(document, clip, index)?.id ?? '');
  return match ? Number(match[1]) : index;
}
