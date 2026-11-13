'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useAction, useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { Archive, ArchiveRestore, ChevronDown, Clapperboard, Download, Folder, FolderInput, FolderPlus, LayoutGrid, List, Search, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { DashboardMenuButton } from '@/components/dashboard/dashboard-navbar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Segmented } from '@/components/ui/segmented';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Toaster } from '@/components/ui/sonner';
import { Toggle } from '@/components/ui/toggle';
import { uploadActivityLabel } from '@/lib/editor/upload-source';
import { userError } from '@/lib/user-error';
import { KIND_LABELS, formatBytes, formatDuration, plural, shortDate } from './format';
import { LibrarySheet } from './library-sheet';
import { AddToProjectDialog, DeleteFilesDialog, DeleteFolderDialog, MoveDialog, NewFolderDialog } from './library-dialogs';
import { useSlowWait } from './library-loading';
import { ArchivedFolderMenu, ArchivedFolderTile, FileThumb, FileTile, FolderMenu, FolderTile, LIBRARY_DRAG, RenameInput, folderHref, folderMeta, openFolder, openFolderLink, useDropTarget, type DragPayload, type FolderId, type LibraryFile, type LibraryFolder } from './library-tiles';
import { useLibraryUpload, type UploadRow } from './use-library-upload';
import { LibraryLinkImports } from './library-link-imports';
import { AddMediaDialog } from './library-add-media';
import './library.css';

type Sort = 'newest' | 'oldest' | 'largest';
type View = 'grid' | 'list';
/** What an archive or restore call takes, and its undo. */
type Items = { fileIds: Id<'storageObjects'>[]; folderIds: FolderId[] };
/** How a toast names what it moved: the one item by name, else a count. */
function itemsLabel(files: { fileName: string }[], folders: { name: string }[] = []) {
  const one = files.length + folders.length === 1 ? files[0]?.fileName ?? folders[0]?.name : null;
  if (one) return `“${one}”`;
  return [files.length ? plural(files.length, 'file') : '', folders.length ? plural(folders.length, 'folder') : ''].filter(Boolean).join(' and ');
}
const SORTS: Record<Sort, string> = { newest: 'Newest', oldest: 'Oldest', largest: 'Largest' };
const VIEWS = [{ value: 'grid', label: <LayoutGrid aria-label="Grid view" /> }, { value: 'list', label: <List aria-label="List view" /> }] as const;
/** Delete, Add to project, Archive and Restore take 20 files a call, so a selection holds that many. */
const MAX_SELECTED = 20;
const PAGE = 24;
const FIRST_PAGE = { numItems: PAGE, cursor: null };
const viewKey = (userId: string) => `revline:library-view:${userId}`;

/** Grid or list, remembered per signed-in user on this browser. */
function useLibraryView() {
  const { user } = useUser(), [view, setView] = useState<View>('grid');
  useEffect(() => { if (!user) return; try { if (localStorage.getItem(viewKey(user.id)) === 'list') setView('list'); } catch { /* Stays on the grid. */ } }, [user]);
  const choose = useCallback((next: View) => { setView(next); if (user) try { localStorage.setItem(viewKey(user.id), next); } catch { /* Kept for this visit only. */ } }, [user]);
  return [view, choose] as const;
}

/** The open folder's breadcrumb from the folders already loaded, or undefined when they do not hold all of it. */
function pathFromTree(tree: LibraryFolder[], id: string) {
  const byId = new Map<string, LibraryFolder>(tree.map(folder => [folder.id, folder])), path: { id: FolderId; name: string }[] = [];
  for (let folder = byId.get(id); folder; folder = folder.parentId ? byId.get(folder.parentId) : undefined) {
    path.unshift({ id: folder.id, name: folder.name });
    if (!folder.parentId) return path;
    if (path.length > tree.length) return undefined;
  }
  return undefined;
}

/** Subscribes to a folder's subfolders and first page of files before it is opened, so opening it reads them from
 *  the client's cache instead of waiting. The arguments match what the page asks for when the folder is open. */
function PrefetchFolder({ folderId, sort }: { folderId?: FolderId; sort: Sort }) {
  useQuery(api.library.folders, folderId ? { parentId: folderId } : {});
  useQuery(api.library.files, { sort, unused: false, ...(folderId ? { folderId } : {}), paginationOpts: FIRST_PAGE });
  return null;
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
function Crumb({ id, name, current, onDropItems, onWarm }: { id?: FolderId; name: string; current: boolean; onDropItems: (payload: DragPayload) => void; onWarm: () => void }) {
  const { over, handlers } = useDropTarget(onDropItems);
  return <BreadcrumbItem data-drop={over || undefined} {...(current ? {} : handlers)}>{current ? <BreadcrumbPage>{name}</BreadcrumbPage> : <BreadcrumbLink asChild><Link href={folderHref(id)} onClick={openFolderLink(id)} onPointerEnter={onWarm} onFocus={onWarm}>{name}</Link></BreadcrumbLink>}</BreadcrumbItem>;
}

export function LibraryPage() {
  const { isAuthenticated } = useConvexAuth();
  const requested = useSearchParams().get('folder') ?? '';
  const tree = useQuery(api.library.folderTree, isAuthenticated ? {} : 'skip');
  // A folder opened from the page is already in the loaded tree, so its path needs no round trip; a pasted link asks the server.
  const knownPath = useMemo(() => tree && requested ? pathFromTree(tree, requested) : undefined, [tree, requested]);
  const fetchedPath = useQuery(api.library.folderPath, isAuthenticated && requested && !knownPath ? { folderId: requested } : 'skip');
  const path = requested ? knownPath ?? fetchedPath : undefined;
  const folderId = path?.at(-1)?.id, resolving = !!requested && path === undefined;
  // A folder that is gone (deleted, or never this account's) opens the Library root instead.
  useEffect(() => { if (requested && path === null) openFolder(null, true); }, [requested, path]);

  const [view, setView] = useLibraryView();
  const [search, setSearch] = useState(''), [sort, setSort] = useState<Sort>('newest'), [unusedOnly, setUnused] = useState(false);
  // The Archived view lists what was archived on its own, newest first; search, sort and the filter wait until it closes.
  const [archived, setArchived] = useState(false), unused = unusedOnly && !archived;
  const searched = useDeferredValue(search.trim()), term = archived ? '' : searched, ready = isAuthenticated && !resolving && !(requested && !folderId);
  const children = useQuery(api.library.folders, ready && !term && !archived ? (folderId ? { parentId: folderId } : {}) : 'skip');
  const archivedFolders = useQuery(api.library.archivedFolders, ready && archived ? {} : 'skip');
  const listArgs = ready && !archived ? { sort, unused, ...(term ? { search: term } : folderId ? { folderId } : {}) } : 'skip';
  const live = usePaginatedQuery(api.library.files, listArgs, { initialNumItems: PAGE });
  const shelf = usePaginatedQuery(api.library.archivedFiles, ready && archived ? {} : 'skip', { initialNumItems: PAGE });
  const { status, loadMore } = archived ? shelf : live, results: LibraryFile[] = archived ? shelf.results : live.results;
  // The paginated list keys its first page by a fresh ID, so it never reuses a prefetch. This plain query has the same
  // arguments as PrefetchFolder's and answers from the cache while that first page loads.
  const prefetched = useQuery(api.library.files, listArgs !== 'skip' && !term && !unused && status === 'LoadingFirstPage' ? { ...listArgs, paginationOpts: FIRST_PAGE } : 'skip');
  const early = status === 'LoadingFirstPage' ? prefetched : undefined;
  // The unused filter drops rows after each page is read, so a page can come back empty while more remain.
  const scanning = unused && results.length === 0 && status === 'CanLoadMore';
  useEffect(() => { if (scanning) loadMore(PAGE); }, [scanning, loadMore]);
  const loading = !ready || (status === 'LoadingFirstPage' && !early) || scanning || (unused && !results.length && status === 'LoadingMore');
  const files = early ? early.page : results, moreFiles = early ? !early.isDone : status === 'CanLoadMore';
  const folders: LibraryFolder[] | undefined = archived ? archivedFolders : term ? tree?.filter(folder => folder.name.toLocaleLowerCase().includes(term.toLocaleLowerCase())) : children;
  // While the next folder loads, the last one stays on screen for a moment instead of a grid of placeholders.
  // Past that moment one quiet "Loading…" line takes its place; a cold load shows nothing until then.
  const busy = loading || folders === undefined;
  // Only a folder change keeps the last view: a new search, sort or filter must not show rows that do not match it.
  const listKey = `${archived}|${term}|${sort}|${unused}`;
  const listing = useMemo(() => folders === undefined ? null : { folders, files, more: moreFiles, view: listKey }, [folders, files, moreFiles, listKey]);
  const [kept, setKept] = useState<typeof listing>(null);
  useEffect(() => { if (!busy) setKept(listing); }, [busy, listing]);
  const slow = useSlowWait(busy);
  const shown = !busy ? listing : slow || !kept || kept.view !== listKey || (!kept.files.length && !kept.folders.length) ? null : kept;
  // The kept view is only a picture of the last folder: its tiles cannot be opened or selected until the new one arrives.
  const stale = !!shown && shown !== listing;
  // Folders to have ready before they are opened: the one under the pointer, the parent and the Library root that the
  // breadcrumb returns to, and the folder just left, for Back. The open folder stays in the set until its own first page
  // has loaded, so its prefetch is not dropped before the page's subscription takes over.
  const [hovered, setHovered] = useState<FolderId | 'root' | null>(null);
  const current = ready ? folderId ?? 'root' : null, [visit, setVisit] = useState<{ at: FolderId | 'root' | null; left: FolderId | 'root' | null }>({ at: null, left: null });
  if (current && current !== visit.at) setVisit({ at: current, left: visit.at });
  const parent = path ? path.at(-2)?.id ?? 'root' : null;
  const prefetch = !current || term || unused || archived ? [] : [...new Set([hovered, parent, 'root' as const, visit.left])].filter((id): id is FolderId | 'root' => id !== null && (id !== current || status === 'LoadingFirstPage'));
  const warm = (id: FolderId | undefined) => () => setHovered(id ?? 'root'), cool = () => setHovered(null);
  const folderNames = useMemo(() => new Map((tree ?? []).map(folder => [folder.id, folder.name])), [tree]);
  const here = path?.at(-1)?.name ?? 'the Library';

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set()), [activeId, setActiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'folder' } | { kind: 'move'; fileIds: Id<'storageObjects'>[]; folderIds: FolderId[]; from?: FolderId | null } | { kind: 'project'; files: LibraryFile[] } | { kind: 'delete'; files: LibraryFile[] } | { kind: 'deleteFolder'; folder: LibraryFolder }>(null);
  const [renaming, setRenaming] = useState<FolderId | null>(null), [error, setError] = useState('');
  const chosen = files.filter(file => selected.has(file.id)), active = files.find(file => file.id === activeId) ?? null;
  const clear = useCallback(() => { setSelected(new Set()); setActiveId(null); }, []);
  // A selection belongs to the list it was made in.
  useEffect(clear, [folderId, term, sort, unused, archived, clear]);
  function toggle(file: LibraryFile) {
    setSelected(current => { const next = new Set(current); if (next.has(file.id)) next.delete(file.id); else if (next.size < MAX_SELECTED) next.add(file.id); return next; });
  }
  // A plain click opens the file's sheet; with Cmd, Ctrl or Shift it adds the file to the selection instead.
  function open(file: LibraryFile, additive: boolean) {
    if (additive) toggle(file); else setActiveId(file.id);
  }
  const activeIndex = active ? files.indexOf(active) : -1;
  const step = (offset: -1 | 1) => { const next = files[activeIndex + offset]; if (next) setActiveId(next.id); };

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
  const archiveItems = useMutation(api.library.archive), restoreItems = useMutation(api.library.restore);
  // Each toast undoes its own call with the other one, and that undo can be undone in turn.
  function archiveNow(items: Items, label: string) {
    setError('');
    void archiveItems(items).then(() => { clear(); toast(`Archived ${label}`, { action: { label: 'Undo', onClick: () => restoreNow(items, label) } }); }, report('Could not archive this. Please retry.'));
  }
  function restoreNow(items: Items, label: string) {
    setError('');
    void restoreItems(items).then(() => { clear(); toast(`Restored ${label}`, { action: { label: 'Undo', onClick: () => archiveNow(items, label) } }); }, report('Could not restore this. Please retry.'));
  }
  const archiveFiles = (files: LibraryFile[]) => archiveNow({ fileIds: files.map(file => file.id), folderIds: [] }, itemsLabel(files));
  const restoreFiles = (files: LibraryFile[]) => restoreNow({ fileIds: files.map(file => file.id), folderIds: [] }, itemsLabel(files));
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

  const [adding, setAdding] = useState(false), importLink = useMutation(api.library.importLink);
  const pick = () => setAdding(true);
  const newFolder = () => setDialog({ kind: 'folder' });

  const folderMenu = (folder: LibraryFolder) => archived ? <ArchivedFolderMenu name={folder.name} onRestore={() => restoreNow({ fileIds: [], folderIds: [folder.id] }, itemsLabel([], [folder]))} />
    : <FolderMenu name={folder.name} onRename={() => setRenaming(folder.id)} onMove={() => setDialog({ kind: 'move', fileIds: [], folderIds: [folder.id], from: folder.parentId })} onArchive={() => archiveNow({ fileIds: [], folderIds: [folder.id] }, itemsLabel([], [folder]))} onDelete={() => setDialog({ kind: 'deleteFolder', folder })} />;
  const empty = !busy && !files.length && !folders?.length;
  const filesTitle = archived ? 'Archived files' : term ? 'Files' : !folderId && sort === 'newest' && !unused ? 'Recent files' : unused ? 'Unused files' : 'Files';
  const blockedDelete = chosen.find(file => !file.canDelete);
  const parentOf = (folder: LibraryFolder) => folder.parentId ? folderNames.get(folder.parentId) ?? 'its parent folder' : 'the Library';

  return <main className="dash-content library-page" {...pageDrop}>
    <h1 className="sr-only">Library</h1>
    <Input ref={fileInput} type="file" accept="video/*,audio/*,image/*" multiple className="library-file-input" tabIndex={-1} aria-label={`Choose files to upload to ${here}`} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; uploads.enqueue(files, folderId); }} />

    <div className="library-head">
      <DashboardMenuButton />
      <Breadcrumb className="library-crumbs"><BreadcrumbList>
        {archived ? <>
          <BreadcrumbItem><BreadcrumbLink asChild><Button variant="ghost" className="library-crumb-button" onClick={() => setArchived(false)}>Library</Button></BreadcrumbLink></BreadcrumbItem>
          <span className="library-crumb-step"><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Archived</BreadcrumbPage></BreadcrumbItem></span>
        </> : <>
          <Crumb name="Library" current={!requested} onDropItems={moveTo(undefined)} onWarm={warm(undefined)} />
          {(path ?? []).map((step, index, all) => <span key={step.id} className="library-crumb-step"><BreadcrumbSeparator /><Crumb id={step.id} name={step.name} current={index === all.length - 1} onDropItems={moveTo(step.id)} onWarm={warm(step.id)} /></span>)}
        </>}
      </BreadcrumbList></Breadcrumb>
    </div>

    <div className="library-toolbar">
      <div className="library-search"><Search aria-hidden="true" /><Input type="search" aria-label="Search files and folders" placeholder="Search files and folders" value={search} maxLength={120} disabled={archived} onChange={event => setSearch(event.target.value)} /></div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="soft" className="library-sort" disabled={archived}>{unused ? 'Unused' : SORTS[sort]}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="dash-menu library-menu">
          <DropdownMenuRadioGroup value={sort} onValueChange={value => setSort(value as Sort)}>{(Object.keys(SORTS) as Sort[]).map(value => <DropdownMenuRadioItem key={value} value={value} disabled={!!term}>{SORTS[value]}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={unused ? 'unused' : 'all'} onValueChange={value => setUnused(value === 'unused')}><DropdownMenuRadioItem value="all">All files</DropdownMenuRadioItem><DropdownMenuRadioItem value="unused">Unused only</DropdownMenuRadioItem></DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Toggle className="library-archived-toggle" pressed={archived} onPressedChange={setArchived} aria-label="Archived files and folders"><Archive aria-hidden="true" /><span>Archived</span></Toggle>
      <Segmented className="library-view" aria-label="View" value={view} onValueChange={setView} options={VIEWS} />
      {!archived && <>
        <Button variant="soft" className="library-desktop-action" onClick={newFolder}><FolderPlus aria-hidden="true" />New folder</Button>
        <Button variant="primary" className="library-desktop-action" onClick={pick}><Upload aria-hidden="true" />Upload</Button>
        <Button variant="soft" size="icon" className="library-phone-action" aria-label="New folder" onClick={newFolder}><FolderPlus /></Button>
        <Button variant="primary" size="icon" className="library-phone-action" aria-label="Upload" onClick={pick}><Upload /></Button>
      </>}
    </div>

    {(error || uploads.error) && <p className="dash-error" role="alert">{error || uploads.error}</p>}
    {cleanupProjects.length > 0 && cleanup !== 'complete' && <p className="library-status" role={cleanup === 'failed' ? 'alert' : 'status'}>{cleanup === 'failed' ? 'Project cleanup stopped. Retry to finish removing its files.' : 'Finishing project cleanup…'}{cleanup === 'failed' && <Button variant="soft" size="sm" disabled={retrying} onClick={() => void retryCleanup()}>{retrying ? 'Retrying…' : 'Retry cleanup'}</Button>}</p>}
    {uploads.rows.length > 0 && <UploadRows rows={uploads.rows} onCancel={uploads.cancel} onRetry={uploads.retry} />}
    <LibraryLinkImports onUpload={() => fileInput.current?.click()} />
    {adding && <AddMediaDialog place={here} onClose={() => setAdding(false)} onUpload={files => uploads.enqueue(files, folderId)} onImportLink={async url => { await importLink({ url, ...(folderId ? { folderId } : {}) }); }} />}

    <div className="library-body" aria-busy={busy} inert={stale}>
      {prefetch.map(id => <PrefetchFolder key={id} folderId={id === 'root' ? undefined : id} sort={sort} />)}
      {empty ? archived ? <div className="library-empty">
        <Archive aria-hidden="true" />
        <h2>Nothing archived</h2>
        <p>Archive files and folders to clear them from your Library. They stay stored, and projects that use them keep working.</p>
      </div> : <div className="library-empty">
        <Folder aria-hidden="true" />
        <h2>{term ? `Nothing matches “${term}”` : unused ? 'No unused files here' : folderId ? 'This folder is empty' : 'Your Library is empty'}</h2>
        <p>{term ? 'Search looks through every folder.' : unused ? 'Every file in this folder is used by a project.' : 'Drop files here, or upload from your computer.'}</p>
        {!term && !unused && <div className="library-empty-actions"><Button variant="primary" onClick={pick}><Upload aria-hidden="true" />Upload</Button>
          {!folderId && <Button variant="soft" title="Raw footage, Exports, Audio, Images" onClick={() => { setError(''); void starters({}).catch(report('Could not create the folders. Please retry.')); }}><FolderPlus aria-hidden="true" />Create starter folders</Button>}</div>}
      </div> : !shown ? slow && <p className="library-loading" role="status">Loading…</p> : view === 'grid' ? <>
        {shown.folders.length > 0 && <section aria-label="Folders">
          <div className="library-section-head"><h2>{archived ? 'Archived folders' : 'Folders'}</h2><span>{shown.folders.length}</span></div>
          <div className="library-folders">{shown.folders.map(folder => archived ? <ArchivedFolderTile key={folder.id} folder={folder} menu={folderMenu(folder)} /> : <FolderTile key={folder.id} folder={folder} renaming={renaming === folder.id} onRename={name => saveFolderName(folder, name)} onRenameEnd={() => setRenaming(null)} menu={folderMenu(folder)} onDropItems={moveTo(folder.id)} onDropFiles={dropped => uploads.enqueue(dropped, folder.id)} onWarm={warm(folder.id)} onCool={cool} />)}</div>
        </section>}
        {shown.files.length > 0 && <section aria-label={filesTitle}>
          <div className="library-section-head"><h2>{filesTitle}</h2><span>{shown.files.length}{shown.more ? '+' : ''}</span></div>
          <div className="library-files">{shown.files.map(file => <FileTile key={file.id} file={file} selected={selected.has(file.id)} active={activeId === file.id} onOpen={additive => open(file, additive)} onToggle={() => toggle(file)} dragPayload={archived ? undefined : () => dragPayload(file)} />)}</div>
        </section>}
      </> : <div className="library-table-card"><Table className="library-table">
        <TableHeader><TableRow>
          <TableHead className="library-col-check"><Checkbox aria-label="Select the files shown" disabled={!files.length} checked={files.length > 0 && files.slice(0, MAX_SELECTED).every(file => selected.has(file.id))} onCheckedChange={value => setSelected(value === true ? new Set(files.slice(0, MAX_SELECTED).map(file => file.id)) : new Set())} /></TableHead>
          <TableHead>Name</TableHead><TableHead className="library-col-type">Type</TableHead><TableHead className="library-col-size">Size</TableHead><TableHead className="library-col-duration">Duration</TableHead><TableHead className="library-col-used">Used in</TableHead><TableHead className="library-col-date">Modified</TableHead><TableHead className="library-col-more"><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {shown.folders.map(folder => archived ? <ArchivedFolderRow key={folder.id} folder={folder} menu={folderMenu(folder)} /> : <FolderRow key={folder.id} folder={folder} renaming={renaming === folder.id} onRename={name => saveFolderName(folder, name)} onRenameEnd={() => setRenaming(null)} menu={folderMenu(folder)} onOpen={() => openFolder(folder.id)} onDropItems={moveTo(folder.id)} onDropFiles={dropped => uploads.enqueue(dropped, folder.id)} onWarm={warm(folder.id)} onCool={cool} />)}
          {shown.files.map(file => <TableRow key={file.id} className="library-row" data-selected={selected.has(file.id) || undefined} data-active={activeId === file.id || undefined} draggable={!archived}
            onDragStart={archived ? undefined : event => { event.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify(dragPayload(file))); event.dataTransfer.effectAllowed = 'move'; }} onClick={event => open(file, event.metaKey || event.ctrlKey || event.shiftKey)}>
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

    {chosen.length > 0 && archived && <div className="library-bar" role="toolbar" aria-label="Selected files">
      <strong>{chosen.length} selected</strong>
      <Button variant="ghost" onClick={() => restoreFiles(chosen)}><ArchiveRestore aria-hidden="true" /><span>Restore</span></Button>
      <Button variant="ghost" onClick={() => void download(chosen)}><Download aria-hidden="true" /><span>Download</span></Button>
      <Button variant="ghost" size="icon" aria-label="Clear the selection" onClick={clear}><X /></Button>
    </div>}
    {chosen.length > 0 && !archived && <div className="library-bar" role="toolbar" aria-label="Selected files">
      <strong>{chosen.length} selected</strong>
      <Button variant="ghost" onClick={() => setDialog({ kind: 'move', fileIds: chosen.map(file => file.id), folderIds: [], ...(term ? {} : { from: folderId ?? null }) })}><FolderInput aria-hidden="true" /><span>Move to</span></Button>
      <Button variant="ghost" onClick={() => setDialog({ kind: 'project', files: chosen })}><Clapperboard aria-hidden="true" /><span>Add to project</span></Button>
      <Button variant="ghost" onClick={() => void download(chosen)}><Download aria-hidden="true" /><span>Download</span></Button>
      <Button variant="ghost" onClick={() => archiveFiles(chosen)}><Archive aria-hidden="true" /><span>Archive</span></Button>
      <Button variant="ghost" disabled={!!blockedDelete} title={blockedDelete ? `${blockedDelete.fileName}: ${blockedDelete.protectedReason ?? 'cannot be deleted right now'}` : undefined} onClick={() => setDialog({ kind: 'delete', files: chosen })}><Trash2 aria-hidden="true" /><span>Delete</span></Button>
      <Button variant="ghost" size="icon" aria-label="Clear the selection" onClick={clear}><X /></Button>
    </div>}
    <LibrarySheet file={active} position={activeIndex} count={files.length} folderName={active?.folderId ? folderNames.get(active.folderId) ?? 'Library' : 'Library'} onClose={() => setActiveId(null)} onStep={step}
      onAddToProject={() => active && setDialog({ kind: 'project', files: [active] })} onDownload={() => active && void download([active])} onDelete={() => active && setDialog({ kind: 'delete', files: [active] })}
      onMove={() => active && setDialog({ kind: 'move', fileIds: [active.id], folderIds: [], from: active.folderId ?? null })}
      archived={archived} onArchive={() => active && archiveFiles([active])} onRestore={() => active && restoreFiles([active])} />
    <Toaster className="library-toaster" />

    {dialog?.kind === 'folder' && <NewFolderDialog parentId={folderId} parentName={here} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'move' && <MoveDialog tree={tree ?? []} fileIds={dialog.fileIds} folderIds={dialog.folderIds} current={dialog.from} onClose={() => setDialog(null)} onMoved={clear} />}
    {dialog?.kind === 'project' && <AddToProjectDialog files={dialog.files} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'delete' && <DeleteFilesDialog files={dialog.files} onClose={() => setDialog(null)} onDeleted={projects => { setDeleting(current => [...new Set([...current, ...projects])]); clear(); }} />}
    {dialog?.kind === 'deleteFolder' && <DeleteFolderDialog folder={dialog.folder} parentName={parentOf(dialog.folder)} onClose={() => setDialog(null)} />}
  </main>;
}

function ArchivedFolderRow({ folder, menu }: { folder: LibraryFolder; menu: React.ReactNode }) {
  return <TableRow className="library-row" data-archived="">
    <TableCell className="library-col-check" />
    <TableCell><span className="library-row-name"><span className="library-file-thumb" data-kind="folder"><Folder aria-hidden="true" /></span><span title={folder.name}>{folder.name}</span></span></TableCell>
    <TableCell className="library-col-type">Folder</TableCell><TableCell className="library-col-size">{formatBytes(folder.totalBytes)}</TableCell><TableCell className="library-col-duration" />
    <TableCell className="library-col-used">{plural(folder.fileCount, 'item')}</TableCell><TableCell className="library-col-date">{shortDate('archivedAt' in folder && typeof folder.archivedAt === 'number' ? folder.archivedAt : folder.updatedAt)}</TableCell>
    <TableCell className="library-col-more">{menu}</TableCell>
  </TableRow>;
}

type FolderRowProps = { folder: LibraryFolder; renaming: boolean; onRename: (name: string) => void; onRenameEnd: () => void; menu: React.ReactNode; onOpen: () => void; onDropItems: (payload: DragPayload) => void; onDropFiles: (files: File[]) => void; onWarm: () => void; onCool: () => void };
function FolderRow({ folder, renaming, onRename, onRenameEnd, menu, onOpen, onDropItems, onDropFiles, onWarm, onCool }: FolderRowProps) {
  const { over, handlers } = useDropTarget(onDropItems, onDropFiles);
  return <TableRow className="library-row" data-drop={over || undefined} draggable={!renaming} onClick={() => { if (!renaming) onOpen(); }} onPointerEnter={onWarm} onPointerLeave={onCool} onFocus={onWarm} onBlur={onCool} {...handlers}
    onDragStart={event => { event.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify({ files: [], folders: [folder.id] } satisfies DragPayload)); event.dataTransfer.effectAllowed = 'move'; }}>
    <TableCell className="library-col-check" />
    <TableCell><span className="library-row-name"><span className="library-file-thumb" data-kind="folder"><Folder aria-hidden="true" /></span>{renaming ? <RenameInput value={folder.name} label={`Rename ${folder.name}`} onSubmit={onRename} onCancel={onRenameEnd} /> : <Link href={folderHref(folder.id)} title={folder.name} onClick={event => { event.stopPropagation(); openFolderLink(folder.id)(event); }}>{folder.name}</Link>}</span></TableCell>
    <TableCell className="library-col-type">Folder</TableCell><TableCell className="library-col-size">{formatBytes(folder.totalBytes)}</TableCell><TableCell className="library-col-duration" />
    <TableCell className="library-col-used">{folderMeta(folder).split(' · ')[0]}</TableCell><TableCell className="library-col-date">{shortDate(folder.updatedAt)}</TableCell>
    <TableCell className="library-col-more" onClick={event => event.stopPropagation()}>{!renaming && menu}</TableCell>
  </TableRow>;
}
