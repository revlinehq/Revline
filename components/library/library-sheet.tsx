'use client';

import { useEffect, useEffectEvent, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { ChevronLeft, ChevronRight, Clapperboard, Download, FolderInput, Pencil, Play, Trash2 } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { userError } from '@/lib/user-error';
import { KIND_LABELS, formatBytes, formatDimensions, formatDuration, longDate } from './format';
import { FileThumb, RenameInput, type LibraryFile } from './library-tiles';

type SheetProps = {
  file: LibraryFile | null; position: number; count: number; folderName: string;
  onClose: () => void; onStep: (offset: -1 | 1) => void;
  onAddToProject: () => void; onMove: () => void; onDownload: () => void; onDelete: () => void;
};

/** One file in a shadcn Sheet over the page (from the right; from the bottom on a phone): preview, name, facts, projects and actions. */
export function LibrarySheet({ file, position, count, folderName, onClose, onStep, ...actions }: SheetProps) {
  const mobile = useIsMobile();
  // Arrow keys step through the files, except where they already mean something: a text field, a player's controls or a dialog on top.
  // Listened for on the window, so stepping onto the last file (which disables › and drops its focus) keeps the keys working.
  const open = !!file, step = useEffectEvent(onStep);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' || event.altKey || event.metaKey || event.ctrlKey || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, video, audio, [data-slot=dialog-content]')) return;
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);
  return <Sheet open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <SheetContent side={mobile ? 'bottom' : 'right'} className="library-sheet">
      {file && <>
        <div className="library-sheet-head">
          <Button variant="ghost" size="icon" className="dash-more" aria-label="Previous file" disabled={position <= 0} onClick={() => onStep(-1)}><ChevronLeft /></Button>
          <Button variant="ghost" size="icon" className="dash-more" aria-label="Next file" disabled={position >= count - 1} onClick={() => onStep(1)}><ChevronRight /></Button>
          <span>{position + 1} of {count}</span>
        </div>
        <SheetTitle className="sr-only">{file.fileName}</SheetTitle>
        <SheetDescription className="sr-only">Preview, details and actions for this file.</SheetDescription>
        <FileDetails key={file.id} file={file} folderName={folderName} {...actions} />
      </>}
    </SheetContent>
  </Sheet>;
}

function FileDetails({ file, folderName, onAddToProject, onMove, onDownload, onDelete }: { file: LibraryFile; folderName: string } & Pick<SheetProps, 'onAddToProject' | 'onMove' | 'onDownload' | 'onDelete'>) {
  const rename = useMutation(api.library.renameFile);
  const [playing, setPlaying] = useState(false), [renaming, setRenaming] = useState(false), [error, setError] = useState('');
  const playable = file.kind === 'video' || file.kind === 'audio' || file.kind === 'export';
  const url = useQuery(api.library.previewUrl, playing && playable ? { fileId: file.id } : 'skip');
  // Keyed by file, so stepping starts fresh. The preview takes the file's own shape: the size stored at upload, else what the thumbnail or the playing video reports.
  const [measured, setMeasured] = useState<{ width: number; height: number; exact: boolean } | null>(null);
  const size = file.width && file.height ? { width: file.width, height: file.height, exact: true } : measured;
  const measure = (width: number, height: number, exact: boolean) => { if (width && height && !(measured?.exact && !exact)) setMeasured({ width, height, exact }); };
  const shaped = size && file.kind !== 'audio';
  async function save(name: string) {
    setRenaming(false); setError('');
    try { await rename({ fileId: file.id, name }); } catch (reason) { setError(userError(reason, 'Could not rename this file. Please retry.')); }
  }
  const facts: [string, string][] = [['Type', KIND_LABELS[file.kind]], ['Size', formatBytes(file.size)], ...(file.duration !== null ? [['Duration', formatDuration(file.duration)] as [string, string]] : []), ...(size?.exact ? [['Dimensions', formatDimensions(size.width, size.height)] as [string, string]] : []), ['Uploaded', longDate(file.createdAt)], ['Folder', folderName]];
  return <div className="library-sheet-body">
    <div className="library-sheet-preview" data-sized={shaped ? '' : undefined} style={shaped ? { '--preview-ratio': size.width / size.height } as CSSProperties : undefined}>
      {playing && url ? (file.kind === 'audio' ? <audio src={url} controls autoPlay /> : <video src={url} controls autoPlay playsInline poster={file.thumbnailUrl ?? undefined}
        onLoadedMetadata={event => measure(event.currentTarget.videoWidth, event.currentTarget.videoHeight, true)} />) : <>
        <FileThumb file={file} badge={false} onImageSize={file.kind === 'audio' ? undefined : (width, height) => measure(width, height, false)} />
        {playable && <Button variant="soft" size="icon" className="library-sheet-play" aria-label={`Play ${file.fileName}`} onClick={() => setPlaying(true)}><Play /></Button>}
      </>}
    </div>
    <div className="library-sheet-name">
      {renaming ? <RenameInput value={file.fileName} label={`Rename ${file.fileName}`} onSubmit={name => void save(name)} onCancel={() => setRenaming(false)} />
        : <><strong title={file.fileName}>{file.fileName}</strong><Button variant="ghost" size="icon" className="dash-more" aria-label={`Rename ${file.fileName}`} onClick={() => setRenaming(true)}><Pencil /></Button></>}
    </div>
    {error && <p className="dash-error" role="alert">{error}</p>}
    <div className="library-sheet-actions">
      <Button variant="soft" onClick={onAddToProject}><Clapperboard aria-hidden="true" />Add to project</Button>
      <Button variant="soft" onClick={onMove}><FolderInput aria-hidden="true" />Move to</Button>
      <Button variant="soft" onClick={onDownload}><Download aria-hidden="true" />Download</Button>
      <Button variant="soft" disabled={!file.canDelete} title={file.canDelete ? undefined : file.protectedReason ?? 'Cannot be deleted right now'} onClick={onDelete}><Trash2 aria-hidden="true" />Delete</Button>
    </div>
    <dl className="library-sheet-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="library-sheet-used">
      <h3>Used in</h3>
      {file.workspaces.length ? <ul>{file.workspaces.map(project => <li key={project.id}><Link href={`/editor/${project.id}`}><Clapperboard aria-hidden="true" /><span>{project.title}</span></Link></li>)}</ul> : <p>Not used in any project.</p>}
      {file.protectedReason && <p>{file.protectedReason}.</p>}
    </div>
  </div>;
}
