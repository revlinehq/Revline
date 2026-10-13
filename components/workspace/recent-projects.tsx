'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useConvexAuth, useQuery } from 'convex/react';
import { ChevronRight, Film, FolderOpen, LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { chatRecency } from './workspace-nav';
import './workspace-pages.css';
import './recent-projects.css';

function ProjectCover({ url, kind }: { url: string | null; kind: 'video' | 'image' | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className="workspace-chat-cover" aria-hidden="true">
    {url && !failed ? kind === 'video'
      ? <video src={`${url}#t=.1`} muted playsInline preload="metadata" onError={() => setFailed(true)} />
      : <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      : <Film size={18} strokeWidth={1.5} />}
  </span>;
}

export function RecentProjects() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const projects = useQuery(api.projects.list, isAuthenticated ? { limit: 6 } : 'skip');
  if (!isAuthenticated && !isLoading) return null;
  const loading = isLoading || projects === undefined;

  return <section className="recent-projects" aria-labelledby="recent-projects-heading">
    <header><h2 id="recent-projects-heading"><FolderOpen size={16} strokeWidth={1.5} aria-hidden="true" />Your projects</h2><Link className="recent-projects-see-all" href="/chats">See all<ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" /></Link></header>
    {loading ? <div className="recent-projects-empty" role="status"><LoaderCircle size={16} className="recent-projects-spinner animate-spin" aria-hidden="true" />Loading your projects…</div>
      : projects.length ? <ul className="recent-projects-list">{projects.map(project => <li key={project._id}>
        <Link className="workspace-chat-row-link recent-project-link" href={`/editor/${project._id}`}>
          <ProjectCover url={project.coverUrl} kind={project.coverKind} />
          <span className="workspace-chat-description"><strong title={project.title}>{project.title}</strong><span>{project.clipCount ? `${project.clipCount} ${project.clipCount === 1 ? 'clip' : 'clips'}` : 'Ready for your footage'}</span></span>
          <time dateTime={new Date(project.updatedAt).toISOString()}>{chatRecency(project.updatedAt)}</time>
        </Link>
      </li>)}</ul>
        : <p className="recent-projects-empty">Your projects will appear here after you add footage.</p>}
  </section>;
}
