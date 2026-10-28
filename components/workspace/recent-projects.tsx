'use client';

import Link from 'next/link';
import { useConvexAuth, useQuery } from 'convex/react';
import { ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/convex/_generated/api';
import { chatRecency } from './workspace-nav';
import { ProjectCover } from './project-cover';
import './workspace-pages.css';
import './recent-projects.css';


export function RecentProjects() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const projects = useQuery(api.projects.list, isAuthenticated ? { limit: 6 } : 'skip');
  if (!isAuthenticated && !isLoading) return null;
  const loading = isLoading || projects === undefined;

  return <section className="recent-projects" aria-labelledby="recent-projects-heading">
    <header><h2 id="recent-projects-heading">Your projects</h2><Link className="recent-projects-see-all" href="/chats">See all<ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" /></Link></header>
    {loading ? <ul className="recent-projects-list" aria-label="Loading your projects" aria-busy="true">{Array.from({length:4},(_,index)=><li key={index}><div className="workspace-chat-row-link recent-project-link"><Skeleton className="workspace-chat-cover"/><span className="workspace-chat-description"><Skeleton style={{height:13,width:'62%'}}/><Skeleton style={{height:10,width:'38%'}}/></span><Skeleton style={{height:11,width:42}}/></div></li>)}</ul>
      : projects.length ? <ul className="recent-projects-list">{projects.map(project => <li key={project._id}>
        <Link className="workspace-chat-row-link recent-project-link" href={`/editor/${project._id}`}>
          <ProjectCover url={project.coverUrl} kind={project.coverKind} />
          <span className="workspace-chat-description"><strong>{project.title}</strong><span>{project.clipCount ? `${project.clipCount} ${project.clipCount === 1 ? 'clip' : 'clips'}` : 'Ready for your footage'}</span></span>
          <time dateTime={new Date(project.updatedAt).toISOString()}>{chatRecency(project.updatedAt)}</time>
        </Link>
      </li>)}</ul>
        : <p className="recent-projects-empty">Your projects will appear here after you add footage.</p>}
  </section>;
}
