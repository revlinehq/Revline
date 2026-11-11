'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { Clapperboard, Folder, FolderOpen, Plus, Search } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { userError } from '@/lib/user-error';
import { formatBytes, plural } from './format';
import type { FolderId, LibraryFile, LibraryFolder } from './library-tiles';

export function NewFolderDialog({ parentId, parentName, onClose, onCreated }: { parentId?: FolderId; parentName: string; onClose: () => void; onCreated?: (id: FolderId) => void }) {
  const create = useMutation(api.library.createFolder);
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try { const id = await create({ name, ...(parentId ? { parentId } : {}) }); onCreated?.(id); onClose(); }
    catch (reason) { setError(userError(reason, 'Could not create this folder. Please retry.')); setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="library-dialog" showCloseButton={false}>
    <form onSubmit={event => void submit(event)}>
      <DialogTitle>New folder</DialogTitle>
      <DialogDescription>It goes into {parentName}.</DialogDescription>
      <Input autoFocus aria-label="Folder name" placeholder="Folder name" value={name} maxLength={80} onChange={event => setName(event.target.value)} />
      {error && <p className="dash-error" role="alert">{error}</p>}
      <div className="library-dialog-actions"><Button type="button" variant="soft" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create'}</Button></div>
    </form>
  </DialogContent></Dialog>;
}

/** Pick the folder to move files and folders into. A folder cannot go into itself or anything inside it. */
/** `current` is the folder the items are in now (null for the Library root); absent when they come from several places. */
export function MoveDialog({ tree, fileIds, folderIds, current, onClose, onMoved }: { tree: LibraryFolder[]; fileIds: Id<'storageObjects'>[]; folderIds: FolderId[]; current?: FolderId | null; onClose: () => void; onMoved: () => void }) {
  const move = useMutation(api.library.move);
  const [target, setTarget] = useState<FolderId | 'root' | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const rows = useMemo(() => {
    const children = new Map<string, LibraryFolder[]>();
    for (const folder of tree) { const key = folder.parentId ?? 'root', list = children.get(key) ?? []; list.push(folder); children.set(key, list); }
    const out: { folder: LibraryFolder; depth: number; blocked: boolean }[] = [];
    const walk = (parent: string, depth: number, blocked: boolean) => { for (const folder of children.get(parent) ?? []) { const stop = blocked || folderIds.includes(folder.id); out.push({ folder, depth, blocked: stop }); walk(folder.id, depth + 1, stop); } };
    walk('root', 1, false);
    return out;
  }, [tree, folderIds]);
  const count = fileIds.length + folderIds.length, here = current === undefined ? undefined : current ?? 'root';
  async function submit() {
    if (busy || !target) return;
    setBusy(true); setError('');
    try { await move({ fileIds, folderIds, ...(target === 'root' ? {} : { targetFolderId: target }) }); onMoved(); onClose(); }
    catch (reason) { setError(userError(reason, 'Could not move this. Please retry.')); setBusy(false); }
  }
  const option = (id: FolderId | 'root', name: string, depth: number, blocked: boolean) => <li key={id}>
    <Button variant="ghost" className="library-tree-row" aria-pressed={target === id} disabled={blocked || id === here} style={{ paddingLeft: 10 + depth * 18 }} onClick={() => setTarget(id)} onDoubleClick={() => void submit()}>
      {target === id ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}<span>{name}</span>{id === here && <small>Current folder</small>}
    </Button>
  </li>;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="library-dialog library-move-dialog" showCloseButton={false}>
    <DialogTitle>Move {count === 1 ? '1 item' : `${count} items`}</DialogTitle>
    <DialogDescription>Choose where {count === 1 ? 'it goes' : 'they go'}.</DialogDescription>
    <ul className="library-tree" aria-label="Folders">{option('root', 'Library', 0, false)}{rows.map(row => option(row.folder.id, row.folder.name, row.depth, row.blocked))}</ul>
    {error && <p className="dash-error" role="alert">{error}</p>}
    <div className="library-dialog-actions"><Button variant="soft" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !target} onClick={() => void submit()}>{busy ? 'Moving…' : 'Move here'}</Button></div>
  </DialogContent></Dialog>;
}

/** Put stored files into one of the owner's projects, or start a new one from them. */
export function AddToProjectDialog({ files, onClose }: { files: LibraryFile[]; onClose: () => void }) {
  const router = useRouter();
  const add = useMutation(api.library.addToProject), createEdit = useMutation(api.storage.createEdit);
  const { results, status, loadMore } = usePaginatedQuery(api.projects.listPage, {}, { initialNumItems: 24 });
  const [search, setSearch] = useState(''), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const [done, setDone] = useState<{ id: Id<'projects'>; title: string; added: number; existing: number } | null>(null);
  const fileIds = files.map(file => file.id), term = search.trim().toLocaleLowerCase();
  const projects = term ? results.filter(project => project.title.toLocaleLowerCase().includes(term)) : results;
  const blocked = files.some(file => file.kind === 'export') ? 'Exports cannot be added to a project.' : '';
  async function choose(project: { _id: Id<'projects'>; title: string }) {
    if (busy) return;
    setBusy(project._id); setError('');
    try { setDone({ id: project._id, title: project.title, ...await add({ fileIds, projectId: project._id }) }); }
    catch (reason) { setError(userError(reason, 'Could not add to this project. Please retry.')); }
    finally { setBusy(null); }
  }
  async function startNew() {
    if (busy) return;
    setBusy('new'); setError('');
    try { router.push(`/editor/${await createEdit({ fileIds })}`); }
    catch (reason) { setError(userError(reason, 'Could not create this edit. Please retry.')); setBusy(null); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="library-dialog library-move-dialog" showCloseButton={false}>
    <DialogTitle>Add to project</DialogTitle>
    {done ? <>
      <DialogDescription>{done.added ? `${plural(done.added, 'file')} added to ${done.title}.` : `${done.title} already has ${done.existing === 1 ? 'this file' : 'these files'}.`}{done.added > 0 && done.existing > 0 && ` ${plural(done.existing, 'file')} ${done.existing === 1 ? 'was' : 'were'} already there.`} Find {done.added + done.existing === 1 ? 'it' : 'them'} in the project’s Media.</DialogDescription>
      <div className="library-dialog-actions"><Button variant="soft" onClick={onClose}>Done</Button><Button asChild variant="primary"><Link href={`/editor/${done.id}`}>Open project</Link></Button></div>
    </> : <>
      <DialogDescription>{plural(files.length, 'file')} · {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}. Files go into the project’s Media, not onto its timeline.</DialogDescription>
      <div className="library-search library-dialog-search"><Search aria-hidden="true" /><Input type="search" aria-label="Search projects" placeholder="Search projects" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <ul className="library-tree" aria-label="Projects">
        {!term && <li><Button variant="ghost" className="library-tree-row" disabled={!!busy || !!blocked || files.some(file => !file.canCreateEdit)} onClick={() => void startNew()}><Plus aria-hidden="true" /><span>{busy === 'new' ? 'Creating project…' : 'New project'}</span></Button></li>}
        {projects.map(project => <li key={project._id}><Button variant="ghost" className="library-tree-row" disabled={!!busy || !!blocked} onClick={() => void choose(project)}><Clapperboard aria-hidden="true" /><span>{project.title}</span>{busy === project._id && <small>Adding…</small>}</Button></li>)}
        {status === 'LoadingFirstPage' && <li className="library-tree-note">Loading your projects…</li>}
        {status !== 'LoadingFirstPage' && !projects.length && <li className="library-tree-note">{term ? 'No project matches.' : 'You have no projects yet.'}</li>}
        {status === 'CanLoadMore' && <li><Button variant="ghost" size="sm" onClick={() => loadMore(24)}>Load more projects</Button></li>}
      </ul>
      {(error || blocked) && <p className="dash-error" role="alert">{error || blocked}</p>}
      <div className="library-dialog-actions"><Button variant="soft" disabled={!!busy} onClick={onClose}>Cancel</Button></div>
    </>}
  </DialogContent></Dialog>;
}

export function DeleteFolderDialog({ folder, parentName, onClose }: { folder: LibraryFolder; parentName: string; onClose: () => void }) {
  const remove = useMutation(api.library.removeFolder);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try { await remove({ folderId: folder.id }); onClose(); }
    catch (reason) { setError(userError(reason, 'Could not delete this folder. Please retry.')); setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="library-dialog" showCloseButton={false}>
    <DialogTitle>Delete “{folder.name}”?</DialogTitle>
    <DialogDescription>Only the folder is deleted. Everything inside it moves to {parentName}; no file is deleted.</DialogDescription>
    {error && <p className="dash-error" role="alert">{error}</p>}
    <div className="library-dialog-actions"><Button variant="soft" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Deleting…' : 'Delete folder'}</Button></div>
  </DialogContent></Dialog>;
}

/** The existing delete confirmation: it names the projects the files take with them. */
export function DeleteFilesDialog({ files, onClose, onDeleted }: { files: LibraryFile[]; onClose: () => void; onDeleted: (projects: Id<'projects'>[]) => void }) {
  const remove = useMutation(api.storage.remove);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const fileIds = files.map(file => file.id);
  // The server also names projects the selection would leave with nothing in them; the files' own projects cover the wait.
  const removed = useQuery(api.storage.deletedProjects, fileIds.length ? { fileIds } : 'skip');
  const used = [...new Map(files.filter(file => file.kind !== 'export').flatMap(file => file.workspaces).map(project => [project.id, project])).values()];
  const doomed = removed ?? used;
  async function submit() {
    if (busy || !files.length) return;
    setBusy(true); setError('');
    try { onDeleted(await remove({ fileIds, confirmedProjects: doomed.map(project => project.id) })); onClose(); }
    catch (reason) { setError(userError(reason, 'Could not delete these files. Nothing from this attempt was removed. Please retry.')); setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="library-dialog" showCloseButton={false}>
    <DialogTitle>Delete {files.length === 1 ? 'this file' : `${files.length} files`}?</DialogTitle>
    <DialogDescription>This permanently removes the selected media from your Library.</DialogDescription>
    {doomed.length > 0 && <div className="library-delete-projects" role="note">
      <p>{doomed.length === 1 ? 'This project will be deleted too:' : `These ${doomed.length} projects will be deleted too:`}</p>
      <ul>{doomed.slice(0, 5).map(project => <li key={project.id}>{project.title}</li>)}{doomed.length > 5 && <li>and {doomed.length - 5} more</li>}</ul>
    </div>}
    <p className="library-dialog-note">{formatBytes(files.reduce((sum, file) => sum + file.size, 0))} in selected files. Storage used updates as cleanup finishes.</p>
    {error && <p className="dash-error" role="alert">{error}</p>}
    <div className="library-dialog-actions"><Button variant="soft" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || removed === undefined} onClick={() => void submit()}>{busy ? 'Deleting…' : doomed.length ? 'Delete files and projects' : 'Delete files'}</Button></div>
  </DialogContent></Dialog>;
}
