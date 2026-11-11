'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { Clapperboard, Pencil, Play, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { userError } from '@/lib/user-error';
import { KIND_LABELS, formatBytes, formatDuration, longDate } from './format';
import { FileThumb, RenameInput, type LibraryFile } from './library-tiles';

/** One file, in a panel beside the list: preview, name (renamed in place), facts and the projects that use it. */
export function LibraryDetails({ file, selectedCount, folderName, onClose }: { file: LibraryFile; selectedCount: number; folderName: string; onClose: () => void }) {
  const rename = useMutation(api.library.renameFile);
  const [playing, setPlaying] = useState(false), [renaming, setRenaming] = useState(false), [error, setError] = useState('');
  const playable = file.kind === 'video' || file.kind === 'audio' || file.kind === 'export';
  const url = useQuery(api.library.previewUrl, playing && playable ? { fileId: file.id } : 'skip');
  useEffect(() => { setPlaying(false); setRenaming(false); setError(''); }, [file.id]);
  async function save(name: string) {
    setRenaming(false); setError('');
    try { await rename({ fileId: file.id, name }); } catch (reason) { setError(userError(reason, 'Could not rename this file. Please retry.')); }
  }
  const facts: [string, string][] = [['Type', KIND_LABELS[file.kind]], ['Size', formatBytes(file.size)], ...(file.duration !== null ? [['Duration', formatDuration(file.duration)] as [string, string]] : []), ['Uploaded', longDate(file.createdAt)], ['Folder', folderName]];
  return <aside className="library-details" aria-label={`Details for ${file.fileName}`}>
    <div className="library-details-head"><span>{selectedCount > 1 ? `1 of ${selectedCount} selected` : 'Details'}</span><Button variant="ghost" size="icon" className="dash-more" aria-label="Close details" onClick={onClose}><X /></Button></div>
    <div className="library-details-preview">
      {playing && url ? (file.kind === 'audio' ? <audio src={url} controls autoPlay /> : <video src={url} controls autoPlay playsInline poster={file.thumbnailUrl ?? undefined} />) : <>
        <FileThumb file={file} badge={false} />
        {playable && <Button variant="soft" size="icon" className="library-details-play" aria-label={`Play ${file.fileName}`} onClick={() => setPlaying(true)}><Play /></Button>}
      </>}
    </div>
    <div className="library-details-name">
      {renaming ? <RenameInput value={file.fileName} label={`Rename ${file.fileName}`} onSubmit={name => void save(name)} onCancel={() => setRenaming(false)} />
        : <><strong title={file.fileName}>{file.fileName}</strong><Button variant="ghost" size="icon" className="dash-more" aria-label={`Rename ${file.fileName}`} onClick={() => setRenaming(true)}><Pencil /></Button></>}
    </div>
    {error && <p className="dash-error" role="alert">{error}</p>}
    <dl className="library-details-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="library-details-used">
      <h3>Used in</h3>
      {file.workspaces.length ? <ul>{file.workspaces.map(project => <li key={project.id}><Link href={`/editor/${project.id}`}><Clapperboard aria-hidden="true" /><span>{project.title}</span></Link></li>)}</ul> : <p>Not used in any project.</p>}
      {file.protectedReason && <p>{file.protectedReason}.</p>}
    </div>
  </aside>;
}
