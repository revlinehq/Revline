import type { Id } from '@/convex/_generated/dataModel';
import { importProjectSources, type ProjectImportProgress, type ProjectImportSession } from './project-import';

type ImportInput = Parameters<typeof importProjectSources>[1];
type ImportDependencies = Parameters<typeof importProjectSources>[2];
type JobProgress = Omit<ProjectImportProgress, 'phase'> & { phase: ProjectImportProgress['phase'] | 'error' };

export class ProjectImportJob {
  progress: JobProgress;
  error: string | null = null;
  private listeners = new Set<() => void>();
  private pending?: Promise<Id<'projects'>>;
  private result?: Id<'projects'>;

  constructor(
    readonly ownerId: string,
    readonly session: ProjectImportSession,
    readonly input: ImportInput,
  ) {
    this.progress = this.preparing();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  start(dependencies: ImportDependencies): Promise<Id<'projects'>> {
    if (this.result) return Promise.resolve(this.result);
    if (this.pending) return this.pending;

    this.error = null;
    this.progress = this.preparing();
    // Defer execution until the shared promise is stored, including reentrant subscribers.
    this.pending = Promise.resolve().then(() => importProjectSources(
      this.session,
      this.input,
      dependencies,
      progress => { this.progress = progress; this.publish(); },
    )).then(projectId => {
      this.result = projectId;
      this.pending = undefined;
      return projectId;
    }, cause => {
      this.pending = undefined;
      this.error = cause instanceof Error && cause.message
        ? cause.message
        : 'Could not prepare your footage. Retry to continue from where it stopped.';
      this.progress = { ...this.progress, phase: 'error' };
      this.publish();
      throw cause;
    });
    this.publish();
    return this.pending;
  }

  private preparing(): JobProgress {
    return { phase: 'preparing', index: 1, total: this.input.files.length + this.input.assetIds.length, percent: 0 };
  }

  private publish() {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* A view subscription cannot interrupt an owned upload. */ }
    }
  }
}

let currentJob: ProjectImportJob | undefined;

export function getProjectImportJob(ownerId: string | undefined): ProjectImportJob | undefined {
  return ownerId && currentJob?.ownerId === ownerId ? currentJob : undefined;
}

export function getOrCreateProjectImportJob(ownerId: string, session: ProjectImportSession, input: ImportInput): ProjectImportJob {
  if (currentJob?.ownerId === ownerId) return currentJob;
  currentJob = new ProjectImportJob(ownerId, session, input);
  return currentJob;
}

export function clearProjectImportJob(job: ProjectImportJob): void {
  if (currentJob === job) currentJob = undefined;
}
