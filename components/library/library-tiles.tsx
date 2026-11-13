'use client';

import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import type { FunctionReturnType } from 'convex/server';
import { AudioLines, Box, Clapperboard, Download, Ellipsis, Folder, ImageIcon, Video } from 'lucide-react';
import type { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { VideoFrame } from '@/components/media/video-frame';
import { usePosterBackfill } from './use-poster-backfill';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useHoverVideo } from './hover-video';
import { formatBytes, formatDuration, plural, shortDate } from './format';

export type LibraryFile = FunctionReturnType<typeof api.library.files>['page'][number];
export type LibraryFolder = FunctionReturnType<typeof api.library.folderTree>[number] & { thumbnails?: { url: string; video: boolean }[] };
export type FolderId = Id<'storageFolders'>;
/** What a drag inside the page carries. Only its presence is readable while dragging; the IDs arrive on drop. */
export const LIBRARY_DRAG = 'application/x-revline-library';
export type DragPayload = { files: Id<'storageObjects'>[]; folders: FolderId[] };
export const folderHref = (id?: string | null) => id ? `/library?folder=${id}` : '/library';
/** Opens a folder in place: the native history call changes only the address, which useSearchParams follows (Back and
 *  Forward too), so the page keeps its loaded lists and skips the router's round trip for a page already on screen. */
export function openFolder(id?: string | null, replace = false) {
  if (replace) { window.history.replaceState(null, '', folderHref(id)); return; }
  window.history.pushState(null, '', folderHref(id));
  // A Link would scroll the new page to the top; so does this.
  window.scrollTo(0, 0);
}
/** A folder link's click: opens in place, leaving new-tab and modified clicks to the browser. */
export function openFolderLink(id?: string | null) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); openFolder(id);
  };
}
export const KIND_ICONS = { video: Video, audio: AudioLines, image: ImageIcon, model: Box, export: Download };

export function readDrag(event: DragEvent): DragPayload | null {
  try { const value = JSON.parse(event.dataTransfer.getData(LIBRARY_DRAG)); return Array.isArray(value?.files) && Array.isArray(value?.folders) ? value : null; } catch { return null; }
}
/** Marks an element as a place to drop Library items or files from the desktop. */
export function useDropTarget(onDropItems: (payload: DragPayload) => void, onDropFiles?: (files: File[]) => void) {
  const [over, setOver] = useState(false), depth = useRef(0);
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(LIBRARY_DRAG) || !!onDropFiles && event.dataTransfer.types.includes('Files');
  return { over, handlers: {
    onDragEnter: (event: DragEvent) => { if (!accepts(event)) return; depth.current++; setOver(true); },
    onDragOver: (event: DragEvent) => { if (!accepts(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = event.dataTransfer.types.includes(LIBRARY_DRAG) ? 'move' : 'copy'; },
    onDragLeave: (event: DragEvent) => { if (!accepts(event)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop: (event: DragEvent) => {
      if (!accepts(event)) return;
      event.preventDefault(); event.stopPropagation(); depth.current = 0; setOver(false);
      const payload = readDrag(event);
      if (payload) onDropItems(payload); else if (onDropFiles && event.dataTransfer.files.length) onDropFiles(Array.from(event.dataTransfer.files));
    },
  } };
}

/** A name being edited in place: Enter or leaving the field saves, Escape cancels. */
export function RenameInput({ value, label, onSubmit, onCancel }: { value: string; label: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(value), input = useRef<HTMLInputElement>(null), done = useRef(false);
  useEffect(() => { const field = input.current; if (!field) return; field.focus(); const dot = value.lastIndexOf('.'); field.setSelectionRange(0, dot > 0 ? dot : value.length); }, [value]);
  const finish = (save: boolean) => { if (done.current) return; done.current = true; const next = name.trim(); if (save && next && next !== value) onSubmit(next); else onCancel(); };
  return <Input ref={input} className="library-rename" aria-label={label} value={name} maxLength={255} onChange={event => setName(event.target.value)}
    onClick={event => event.stopPropagation()} onBlur={() => finish(true)}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); finish(true); } else if (event.key === 'Escape') { event.preventDefault(); finish(false); } }} />;
}

export function FolderMenu({ name, onRename, onMove, onDelete }: { name: string; onRename: () => void; onMove: () => void; onDelete: () => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="library-folder-more" aria-label={`More for ${name}`}><Ellipsis /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="dash-menu">
      <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
      <DropdownMenuItem onSelect={onMove}>Move to</DropdownMenuItem>
      <DropdownMenuItem onSelect={onDelete}>Delete folder</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

type FolderProps = { folder: LibraryFolder; renaming: boolean; onRename: (name: string) => void; onRenameEnd: () => void; menu: ReactNode; onDropItems: (payload: DragPayload) => void; onDropFiles: (files: File[]) => void; onWarm?: () => void; onCool?: () => void };
const dragFolder = (folder: LibraryFolder) => (event: DragEvent) => { event.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify({ files: [], folders: [folder.id] } satisfies DragPayload)); event.dataTransfer.effectAllowed = 'move'; };
export const folderMeta = (folder: LibraryFolder) => folder.fileCount ? `${plural(folder.fileCount, 'item')} · ${formatBytes(folder.totalBytes)}` : '0 items';

export function FolderTile({ folder, renaming, onRename, onRenameEnd, menu, onDropItems, onDropFiles, onWarm, onCool }: FolderProps) {
  const { over, handlers } = useDropTarget(onDropItems, onDropFiles);
  const thumbnails = folder.thumbnails ?? [], blanks = Math.max(0, Math.min(3, folder.fileCount) - thumbnails.length);
  const body = <>
    <span className="library-folder-top">
      <Folder className="library-folder-icon" aria-hidden="true" />
      <span className="library-folder-stack" aria-hidden="true">{thumbnails.map(({ url, video }) => video ? <VideoFrame key={url} src={url} /> : <img key={url} src={url} alt="" loading="lazy" decoding="async" draggable={false} />)}{Array.from({ length: blanks }, (_, index) => <i key={index} />)}</span>
    </span>
    {renaming ? <RenameInput value={folder.name} label={`Rename ${folder.name}`} onSubmit={onRename} onCancel={onRenameEnd} /> : <strong title={folder.name}>{folder.name}</strong>}
    <small>{folderMeta(folder)}</small>
  </>;
  return <div className="library-folder" data-drop={over || undefined} draggable={!renaming} onDragStart={dragFolder(folder)} onPointerEnter={onWarm} onPointerLeave={onCool} onFocus={onWarm} onBlur={onCool} {...handlers}>
    {renaming ? <div className="library-folder-link">{body}</div> : <Link href={folderHref(folder.id)} className="library-folder-link" draggable={false} onClick={openFolderLink(folder.id)}>{body}</Link>}
    {!renaming && menu}
  </div>;
}

/** The picture of a file: its thumbnail, its first frame, its waveform, or its type icon; with the duration in a corner. */
export function FileThumb({ file, badge = true, onImageSize }: { file: LibraryFile; badge?: boolean; onImageSize?: (width: number, height: number) => void }) {
  const Icon = KIND_ICONS[file.kind], savePoster = usePosterBackfill();
  return <span className="library-file-thumb" data-kind={file.kind} data-wave={file.waveform ? '' : undefined}>
    {file.thumbnailUrl ? <img src={file.thumbnailUrl} alt="" loading="lazy" decoding="async" draggable={false} onLoad={onImageSize && (event => onImageSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight))} />
      : file.videoUrl ? <VideoFrame key={file.videoUrl} src={file.videoUrl} fallback={<Icon aria-hidden="true" />} onSize={onImageSize} onPoster={file.kind === 'video' && file.cloudOnly ? savePoster(file.id) : undefined} />
      : file.waveform ? <span className="library-wave" aria-hidden="true">{file.waveform.map((value, index) => <i key={index} style={{ height: `${Math.max(6, value * 100)}%` }} />)}</span>
      : <Icon aria-hidden="true" />}
    {badge && file.duration !== null && <span className="library-file-duration">{formatDuration(file.duration)}</span>}
  </span>;
}
export const usedIn = (file: LibraryFile) => file.workspaces.length ? `In ${plural(file.workspaces.length, 'project')}` : '';

type FileProps = { file: LibraryFile; selected: boolean; active: boolean; onOpen: (additive: boolean) => void; onToggle: () => void; dragPayload: () => DragPayload };
export function FileTile({ file, selected, active, onOpen, onToggle, dragPayload }: FileProps) {
  const hover = useHoverVideo(file.id, file.kind === 'video' || file.kind === 'export', file.videoUrl);
  return <div className="library-file" data-selected={selected || undefined} data-active={active || undefined} draggable {...hover.handlers}
    onDragStart={event => { hover.stop(); event.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify(dragPayload())); event.dataTransfer.effectAllowed = 'move'; }}>
    <Button variant="ghost" className="library-file-hit" aria-label={`Details for ${file.fileName}`} aria-pressed={active} onClick={event => onOpen(event.metaKey || event.ctrlKey || event.shiftKey)}>
      <span className="library-file-media"><FileThumb file={file} />{hover.video}</span>
      <strong title={file.fileName}>{file.fileName}</strong>
      <small>{formatBytes(file.size)} · {shortDate(file.createdAt)}</small>
      {file.workspaces.length > 0 && <small className="library-file-used"><Clapperboard aria-hidden="true" />{usedIn(file)}</small>}
    </Button>
    <Checkbox className="library-file-check" aria-label={`Select ${file.fileName}`} checked={selected} onCheckedChange={onToggle} />
  </div>;
}
