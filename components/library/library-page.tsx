'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useAction, useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { ChevronDown, Clapperboard, Download, Folder, FolderInput, FolderPlus, LayoutGrid, List, Search, Trash2, Upload, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Segmented } from '@/components/ui/segmented';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { uploadActivityLabel } from '@/lib/editor/upload-source';
import { userError } from '@/lib/user-error';
import { KIND_LABELS, formatBytes, formatDuration, plural, shortDate } from './format';
import { LibrarySheet } from './library-sheet';
import { AddToProjectDialog, DeleteFilesDialog, DeleteFolderDialog, MoveDialog, NewFolderDialog } from './library-dialogs';
import { FileRowsSkeleton, FileTilesSkeleton, FolderTilesSkeleton } from './library-skeleton';
import { FileThumb, FileTile, FolderMenu, FolderTile, LIBRARY_DRAG, RenameInput, folderHref, folderMeta, useDropTarget, type DragPayload, type FolderId, type LibraryFile, type LibraryFolder } from './library-tiles';
import { useLibraryUpload, type UploadRow } from './use-library-upload';
import './library.css';

type Sort = 'newest' | 'oldest' | 'largest';
type View = 'grid' | 'list';
const SORTS: Record<Sort, string> = { newest: 'Newest', oldest: 'Oldest', largest: 'Largest' };
const VIEWS = [{ value: 'grid', label: <LayoutGrid aria-label="Grid view" /> }, { value: 'list', label: <List aria-label="List view" /> }] as const;
/** Delete and Add to project take 20 files a call, so a selection holds that many. */
const MAX_SELECTED = 20;
const PAGE = 24;
const viewKey = (userId: string) => `revline:library-view:${userId}`;

/** Grid or list, remembered per signed-in user on this browser. */
function useLibraryView() {
  const { user } = useUser(), [view, setView] = useState<View>('grid');
  useEffect(() => { if (!user) return; try { if (localStorage.getItem(viewKey(user.id)) === 'list') setView('list'); } catch { /* Stays on the grid. */ } }, [user]);
  const choose = useCallback((next: View) => { setView(next); if (user) try { localStorage.setItem(viewKey(user.id), next); } catch { /* Kept for this visit only. */ } }, [user]);
  return [view, choose] as const;
}

function UploadRows({ rows, onCancel, onRetry }: { rows: UploadRow[]; onCancel: (id: string) => void; onRetry: (id: string) => void }) {
  return <ul className="library-uploads" aria-label="Uploads">{rows.map(row => {
    const percent = row.state.kind === 'uploading' ? row.state.percent : row.state.kind === 'saving' ? 100 : 0, failed = row.state.kind === 'failed';
    const note = row.state.kind === 'uploading' ? (row.state.activity && uploadActivityLabel(row.state.activity, percent)) || `${formatBytes(row.size * percent / 100)} of ${formatBytes(row.size)}`
      : row.state.kind === 'failed' ? row.state.message : row.state.kind === 'saving' ? 'Saving…' : row.state.kind === 'reading' ? 'Reading…' : 'Waiting';
    return <li key={row.id} className="library-upload" data-failed={failed || undefined}>
      <Upload aria-hidden="true" />
      <strong title={row.name}>{row.name}</strong>
      <span className="library-upload-note" role={failed ? 'alert' : undefined}>{note}</span>
      {failed ? <Button variant="soft" size="sm" onClick={() => onRetry(row.id)}>Retry</Button> : <><Progress className="library-upload-bar" value={percent} aria-label={`Uploading ${row.name}`} /><span className="library-upload-percent">{percent}%</span></>}
      <Button variant="ghost" size="icon" className="dash-more" aria-label={failed ? `Dismiss ${row.name}` : `Cancel upload of ${row.name}`} onClick={() => onCancel(row.id)}><X /></Button>
    </li>;
  })}</ul>;
}

/** A breadcrumb step that also takes dropped items, to move them up. */
function Crumb({ id, name, current, onDropItems }: { id?: FolderId; name: string; current: boolean; onDropItems: (payload: DragPayload) => void }) {
  const { over, handlers } = useDropTarget(onDropItems);
  return <BreadcrumbItem data-drop={over || undefined} {...(current ? {} : handlers)}>{current ? <BreadcrumbPage>{name}</BreadcrumbPage> : <BreadcrumbLink asChild><Link href={folderHref(id)}>{name}</Link></BreadcrumbLink>}</BreadcrumbItem>;
}

export function LibraryPage() {
  const router = useRouter(), { isAuthenticated } = useConvexAuth();
  const requested = useSearchParams().get('folder') ?? '';
  const path = useQuery(api.library.folderPath, isAuthenticated && requested ? { folderId: requested } : 'skip');
  const folderId = path?.at(-1)?.id, resolving = !!requested && path === undefined;
  // A folder that is gone (deleted, or never this account's) opens the Library root instead.
  useEffect(() => { if (requested && path === null) router.replace('/library'); }, [requested, path, router]);

  const [view, setView] = useLibraryView();
  const [search, setSearch] = useState(''), [sort, setSort] = useState<Sort>('newest'), [unused, setUnused] = useState(false);
  const term = useDeferredValue(search.trim()), ready = isAuthenticated && !resolving && !(requested && !folderId);
  const tree = useQuery(api.library.folderTree, isAuthenticated ? {} : 'skip');
  const children = useQuery(api.library.folders, ready && !term ? (folderId ? { parentId: folderId } : {}) : 'skip');
  const { results, status, loadMore } = usePaginatedQuery(api.library.files, ready ? { sort, unused, ...(term ? { search: term } : folderId ? { folderId } : {}) } : 'skip', { initialNumItems: PAGE });
  // The unused filter drops rows after each page is read, so a page can come back empty while more remain.
  const scanning = unused && results.length === 0 && status === 'CanLoadMore';
  useEffect(() => { if (scanning) loadMore(PAGE); }, [scanning, loadMore]);
  const loading = !ready || status === 'LoadingFirstPage' || scanning || (unused && !results.length && status === 'LoadingMore');
  const folders: LibraryFolder[] | undefined = term ? tree?.filter(folder => folder.name.toLocaleLowerCase().includes(term.toLocaleLowerCase())) : children;
  const folderNames = useMemo(() => new Map((tree ?? []).map(folder => [folder.id, folder.name])), [tree]);
  const here = path?.at(-1)?.name ?? 'the Library';

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set()), [activeId, setActiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'folder' } | { kind: 'move'; fileIds: Id<'storageObjects'>[]; folderIds: FolderId[]; from?: FolderId | null } | { kind: 'project'; files: LibraryFile[] } | { kind: 'delete'; files: LibraryFile[] } | { kind: 'deleteFolder'; folder: LibraryFolder }>(null);
  const [renaming, setRenaming] = useState<FolderId | null>(null), [error, setError] = useState('');
  const chosen = results.filter(file => selected.has(file.id)), active = results.find(file => file.id === activeId) ?? null;
  const clear = useCallback(() => { setSelected(new Set()); setActiveId(null); }, []);
  // A selection belongs to the list it was made in.
  useEffect(clear, [folderId, term, sort, unused, clear]);
  function toggle(file: LibraryFile) {
    setSelected(current => { const next = new Set(current); if (next.has(file.id)) next.delete(file.id); else if (next.size < MAX_SELECTED) next.add(file.id); return next; });
  }
  // A plain click opens the file's sheet; with Cmd, Ctrl or Shift it adds the file to the selection instead.
  function open(file: LibraryFile, additive: boolean) {
    if (additive) toggle(file); else setActiveId(file.id);
  }
  const activeIndex = active ? results.indexOf(active) : -1;
  const step = (offset: -1 | 1) => { const next = results[activeIndex + offset]; if (next) setActiveId(next.id); };

  const move = useMutation(api.library.move), renameFolder = useMutation(api.library.renameFolder), starters = useMutation(api.library.createStarterFolders), downloadUrl = useAction(api.library.downloadUrl);
  const uploads = useLibraryUpload(), fileInput = useRef<HTMLInputElement>(null);
  const report = (fallback: string) => (reason: unknown) => setError(userError(reason, fallback));
  const moveTo = (target: FolderId | undefined) => (payload: DragPayload) => {
    const folderIds = payload.folders.filter(id => id !== target);
    if (!payload.files.length && !folderIds.length) return;
    setError('');
    void move({ fileIds: payload.files, folderIds, ...(target ? { targetFolderId: target } : {}) }).then(clear, report('Could not move this. Please retry.'));
  };
  const dragPayload = (file: LibraryFile): DragPayload => ({ files: selected.has(file.id) ? chosen.map(item => item.id) : [file.id], folders: [] });
  async function download(files: LibraryFile[]) {
    setError('');
    for (const file of files) {
      try { const link = document.createElement('a'); link.href = await downloadUrl({ fileId: file.id }); link.download = file.fileName; link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove(); }
      catch (reason) { report(`Could not download ${file.fileName}. Please retry.`)(reason); return; }
      // Browsers drop downloads started in the same instant.
      if (files.length > 1) await new Promise(resolve => setTimeout(resolve, 600));
    }
  }
  function saveFolderName(folder: LibraryFolder, name: string) { setRenaming(null); setError(''); void renameFolder({ folderId: folder.id, name }).catch(report('Could not rename this folder. Please retry.')); }

  // Files dragged in from the desktop upload into the open folder.
  const [dropping, setDropping] = useState(false), dragDepth = useRef(0);
  const fromDesktop = (event: DragEvent) => event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes(LIBRARY_DRAG);
  const pageDrop = {
    onDragEnter: (event: DragEvent) => { if (!fromDesktop(event)) return; dragDepth.current++; setDropping(true); },
    onDragOver: (event: DragEvent) => { if (fromDesktop(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: (event: DragEvent) => { if (!fromDesktop(event)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropping(false); },
    // A folder tile takes its own drops and stops them there, so the overlay is cleared on the way down.
    onDropCapture: () => { dragDepth.current = 0; setDropping(false); },
    onDrop: (event: DragEvent) => { if (!fromDesktop(event)) return; event.preventDefault(); uploads.enqueue(Array.from(event.dataTransfer.files), folderId); },
  };

  // Projects that a delete took with it finish cleaning up in the background.
  const [deleting, setDeleting] = useState<Id<'projects'>[]>([]), [retrying, setRetrying] = useState(false);
  const pending = useQuery(api.projects.pendingDeletions, isAuthenticated ? {} : 'skip');
  const cleanupProjects = useMemo(() => [...new Set([...deleting, ...(pending ?? [])])], [deleting, pending]);
  const cleanup = useQuery(api.projects.deletionStatus, isAuthenticated && cleanupProjects.length ? { projectIds: cleanupProjects } : 'skip');
  const retryDeletion = useMutation(api.projects.retryDeletion);
  async function retryCleanup() { if (retrying) return; setRetrying(true); try { await retryDeletion({ projectIds: cleanupProjects }); } catch (reason) { report('Cleanup could not finish. Please retry.')(reason); } finally { setRetrying(false); } }

  // Phone: New folder and Upload sit in the navbar.
  const [navbar, setNavbar] = useState<HTMLElement | null>(null);
  useEffect(() => setNavbar(document.getElementById('dash-navbar-page')), []);
  const pick = () => fileInput.current?.click();
  const newFolder = () => setDialog({ kind: 'folder' });

  const folderMenu = (folder: LibraryFolder) => <FolderMenu name={folder.name} onRename={() => setRenaming(folder.id)} onMove={() => setDialog({ kind: 'move', fileIds: [], folderIds: [folder.id], from: folder.parentId })} onDelete={() => setDialog({ kind: 'deleteFolder', folder })} />;
  const empty = !loading && !results.length && !folders?.length;
  const filesTitle = term ? 'Files' : !folderId && sort === 'newest' && !unused ? 'Recent files' : unused ? 'Unused files' : 'Files';
  const blockedDelete = chosen.find(file => !file.canDelete);
  const parentOf = (folder: LibraryFolder) => folder.parentId ? folderNames.get(folder.parentId) ?? 'its parent folder' : 'the Library';

  return <main className="dash-content library-page" {...pageDrop}>
    <h1 className="sr-only">Library</h1>
    <Input ref={fileInput} type="file" accept="video/*,audio/*,image/*" multiple className="library-file-input" tabIndex={-1} aria-label={`Choose files to upload to ${here}`} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; uploads.enqueue(files, folderId); }} />
    {navbar && createPortal(<><Button variant="soft" size="icon" aria-label="New folder" onClick={newFolder}><FolderPlus /></Button><Button variant="primary" size="icon" aria-label="Upload" onClick={pick}><Upload /></Button></>, navbar)}

    <div className="library-head">
      <Breadcrumb className="library-crumbs"><BreadcrumbList>
        <Crumb name="Library" current={!requested} onDropItems={moveTo(undefined)} />
        {(path ?? []).map((step, index, all) => <span key={step.id} className="library-crumb-step"><BreadcrumbSeparator /><Crumb id={step.id} name={step.name} current={index === all.length - 1} onDropItems={moveTo(step.id)} /></span>)}
      </BreadcrumbList></Breadcrumb>
    </div>

    <div className="library-toolbar">
      <div className="library-search"><Search aria-hidden="true" /><Input type="search" aria-label="Search files and folders" placeholder="Search files and folders" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} /></div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="soft" className="library-sort">{unused ? 'Unused' : SORTS[sort]}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="dash-menu library-menu">
          <DropdownMenuRadioGroup value={sort} onValueChange={value => setSort(value as Sort)}>{(Object.keys(SORTS) as Sort[]).map(value => <DropdownMenuRadioItem key={value} value={value} disabled={!!term}>{SORTS[value]}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={unused ? 'unused' : 'all'} onValueChange={value => setUnused(value === 'unused')}><DropdownMenuRadioItem value="all">All files</DropdownMenuRadioItem><DropdownMenuRadioItem value="unused">Unused only</DropdownMenuRadioItem></DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Segmented className="library-view" aria-label="View" value={view} onValueChange={setView} options={VIEWS} />
      <Button variant="soft" className="library-desktop-action" onClick={newFolder}><FolderPlus aria-hidden="true" />New folder</Button>
      <Button variant="primary" className="library-desktop-action" onClick={pick}><Upload aria-hidden="true" />Upload</Button>
    </div>

    {(error || uploads.error) && <p className="dash-error" role="alert">{error || uploads.error}</p>}
    {cleanupProjects.length > 0 && cleanup !== 'complete' && <p className="library-status" role={cleanup === 'failed' ? 'alert' : 'status'}>{cleanup === 'failed' ? 'Project cleanup stopped. Retry to finish removing its files.' : 'Finishing project cleanup…'}{cleanup === 'failed' && <Button variant="soft" size="sm" disabled={retrying} onClick={() => void retryCleanup()}>{retrying ? 'Retrying…' : 'Retry cleanup'}</Button>}</p>}
    {uploads.rows.length > 0 && <UploadRows rows={uploads.rows} onCancel={uploads.cancel} onRetry={uploads.retry} />}

    <div className="library-body" aria-busy={loading}>
      {empty ? <div className="library-empty">
        <Folder aria-hidden="true" />
        <h2>{term ? `Nothing matches “${term}”` : unused ? 'No unused files here' : folderId ? 'This folder is empty' : 'Your Library is empty'}</h2>
        <p>{term ? 'Search looks through every folder.' : unused ? 'Every file in this folder is used by a project.' : 'Drop files here, or upload from your computer.'}</p>
        {!term && !unused && <div className="library-empty-actions"><Button variant="primary" onClick={pick}><Upload aria-hidden="true" />Upload</Button>
          {!folderId && <Button variant="soft" title="Raw footage, Exports, Audio, Images" onClick={() => { setError(''); void starters({}).catch(report('Could not create the folders. Please retry.')); }}><FolderPlus aria-hidden="true" />Create starter folders</Button>}</div>}
      </div> : view === 'grid' ? <>
        {(folders === undefined ? !term : folders.length > 0) && <section aria-label="Folders">
          <div className="library-section-head"><h2>Folders</h2>{folders && <span>{folders.length}</span>}</div>
          {folders ? <div className="library-folders">{folders.map(folder => <FolderTile key={folder.id} folder={folder} renaming={renaming === folder.id} onRename={name => saveFolderName(folder, name)} onRenameEnd={() => setRenaming(null)} menu={folderMenu(folder)} onDropItems={moveTo(folder.id)} onDropFiles={files => uploads.enqueue(files, folder.id)} />)}</div> : <FolderTilesSkeleton />}
        </section>}
        {(loading || results.length > 0) && <section aria-label={filesTitle}>
          <div className="library-section-head"><h2>{filesTitle}</h2>{!loading && <span>{results.length}{status === 'CanLoadMore' ? '+' : ''}</span>}</div>
          {loading ? <FileTilesSkeleton /> : <div className="library-files">{results.map(file => <FileTile key={file.id} file={file} selected={selected.has(file.id)} active={activeId === file.id} onOpen={additive => open(file, additive)} onToggle={() => toggle(file)} dragPayload={() => dragPayload(file)} />)}</div>}
        </section>}
      </> : loading && !folders?.length ? <FileRowsSkeleton /> : <div className="library-table-card"><Table className="library-table">
        <TableHeader><TableRow>
          <TableHead className="library-col-check"><Checkbox aria-label="Select the files shown" disabled={!results.length} checked={results.length > 0 && results.slice(0, MAX_SELECTED).every(file => selected.has(file.id))} onCheckedChange={value => setSelected(value === true ? new Set(results.slice(0, MAX_SELECTED).map(file => file.id)) : new Set())} /></TableHead>
          <TableHead>Name</TableHead><TableHead className="library-col-type">Type</TableHead><TableHead className="library-col-size">Size</TableHead><TableHead className="library-col-duration">Duration</TableHead><TableHead className="library-col-used">Used in</TableHead><TableHead className="library-col-date">Modified</TableHead><TableHead className="library-col-more"><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {folders?.map(folder => <FolderRow key={folder.id} folder={folder} renaming={renaming === folder.id} onRename={name => saveFolderName(folder, name)} onRenameEnd={() => setRenaming(null)} menu={folderMenu(folder)} onOpen={() => router.push(folderHref(folder.id))} onDropItems={moveTo(folder.id)} onDropFiles={files => uploads.enqueue(files, folder.id)} />)}
          {results.map(file => <TableRow key={file.id} className="library-row" data-selected={selected.has(file.id) || undefined} data-active={activeId === file.id || undefined} draggable
            onDragStart={event => { event.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify(dragPayload(file))); event.dataTransfer.effectAllowed = 'move'; }} onClick={event => open(file, event.metaKey || event.ctrlKey || event.shiftKey)}>
            <TableCell className="library-col-check" onClick={event => event.stopPropagation()}><Checkbox aria-label={`Select ${file.fileName}`} checked={selected.has(file.id)} onCheckedChange={() => toggle(file)} /></TableCell>
            <TableCell><span className="library-row-name"><FileThumb file={file} badge={false} /><Button variant="ghost" title={file.fileName}>{file.fileName}</Button></span></TableCell>
            <TableCell className="library-col-type">{KIND_LABELS[file.kind]}</TableCell><TableCell className="library-col-size">{formatBytes(file.size)}</TableCell>
            <TableCell className="library-col-duration">{file.duration !== null && formatDuration(file.duration)}</TableCell>
            <TableCell className="library-col-used">{file.workspaces.length > 1 ? plural(file.workspaces.length, 'project') : file.workspaces[0]?.title ?? 'Not used'}</TableCell>
            <TableCell className="library-col-date">{shortDate(file.createdAt)}</TableCell><TableCell className="library-col-more" />
          </TableRow>)}
        </TableBody>
      </Table></div>}
      {(status === 'CanLoadMore' || status === 'LoadingMore') && !scanning && results.length > 0 && <div className="library-more"><Button variant="soft" disabled={status === 'LoadingMore'} onClick={() => loadMore(PAGE)}>{status === 'LoadingMore' ? 'Loading…' : 'Load more'}</Button></div>}
      {dropping && <div className="library-drop" aria-hidden="true"><Upload /><strong>Drop files to upload</strong><span>They go into {here}.</span></div>}
    </div>

    {chosen.length > 0 && <div className="library-bar" role="toolbar" aria-label="Selected files">
      <strong>{chosen.length} selected</strong>
      <Button variant="ghost" onClick={() => setDialog({ kind: 'move', fileIds: chosen.map(file => file.id), folderIds: [], ...(term ? {} : { from: folderId ?? null }) })}><FolderInput aria-hidden="true" /><span>Move to</span></Button>
      <Button variant="ghost" onClick={() => setDialog({ kind: 'project', files: chosen })}><Clapperboard aria-hidden="true" /><span>Add to project</span></Button>
      <Button variant="ghost" onClick={() => void download(chosen)}><Download aria-hidden="true" /><span>Download</span></Button>
      <Button variant="ghost" disabled={!!blockedDelete} title={blockedDelete ? `${blockedDelete.fileName}: ${blockedDelete.protectedReason ?? 'cannot be deleted right now'}` : undefined} onClick={() => setDialog({ kind: 'delete', files: chosen })}><Trash2 aria-hidden="true" /><span>Delete</span></Button>
      <Button variant="ghost" size="icon" aria-label="Clear the selection" onClick={clear}><X /></Button>
    </div>}
    <LibrarySheet file={active} position={activeIndex} count={results.length} folderName={active?.folderId ? folderNames.get(active.folderId) ?? 'Library' : 'Library'} onClose={() => setActiveId(null)} onStep={step}
      onAddToProject={() => active && setDialog({ kind: 'project', files: [active] })} onDownload={() => active && void download([active])} onDelete={() => active && setDialog({ kind: 'delete', files: [active] })}
      onMove={() => active && setDialog({ kind: 'move', fileIds: [active.id], folderIds: [], from: active.folderId ?? null })} />

    {dialog?.kind === 'folder' && <NewFolderDialog parentId={folderId} parentName={here} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'move' && <MoveDialog tree={tree ?? []} fileIds={dialog.fileIds} folderIds={dialog.folderIds} current={dialog.from} onClose={() => setDialog(null)} onMoved={clear} />}
    {dialog?.kind === 'project' && <AddToProjectDialog files={dialog.files} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'delete' && <DeleteFilesDialog files={dialog.files} onClose={() => setDialog(null)} onDeleted={projects => { setDeleting(current => [...new Set([...current, ...projects])]); clear(); }} />}
    {dialog?.kind === 'deleteFolder' && <DeleteFolderDialog folder={dialog.folder} parentName={parentOf(dialog.folder)} onClose={() => setDialog(null)} />}
  </main>;
}

type FolderRowProps = { folder: LibraryFolder; renaming: boolean; onRename: (name: string) => void; onRenameEnd: () => void; menu: React.ReactNode; onOpen: () => void; onDropItems: (payload: DragPayload) => void; onDropFiles: (files: File[]) => void };
function FolderRow({ folder, renaming, onRename, onRenameEnd, menu, onOpen, onDropItems, onDropFiles }: FolderRowProps) {
  const { over, handlers } = useDropTarget(onDropItems, onDropFiles);
  return <TableRow className="library-row" data-drop={over || undefined} draggable={!renaming} onClick={() => { if (!renaming) onOpen(); }} {...handlers}
    onDragStart={event => { event.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify({ files: [], folders: [folder.id] } satisfies DragPayload)); event.dataTransfer.effectAllowed = 'move'; }}>
    <TableCell className="library-col-check" />
    <TableCell><span className="library-row-name"><span className="library-file-thumb" data-kind="folder"><Folder aria-hidden="true" /></span>{renaming ? <RenameInput value={folder.name} label={`Rename ${folder.name}`} onSubmit={onRename} onCancel={onRenameEnd} /> : <Link href={folderHref(folder.id)} title={folder.name} onClick={event => event.stopPropagation()}>{folder.name}</Link>}</span></TableCell>
    <TableCell className="library-col-type">Folder</TableCell><TableCell className="library-col-size">{formatBytes(folder.totalBytes)}</TableCell><TableCell className="library-col-duration" />
    <TableCell className="library-col-used">{folderMeta(folder).split(' · ')[0]}</TableCell><TableCell className="library-col-date">{shortDate(folder.updatedAt)}</TableCell>
    <TableCell className="library-col-more" onClick={event => event.stopPropagation()}>{!renaming && menu}</TableCell>
  </TableRow>;
}
