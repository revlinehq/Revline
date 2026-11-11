import { Skeleton } from '@/components/ui/skeleton';
import './editor-chat.css';
import './editor-skeleton.css';

/**
 * The editor's frame, shown the moment a project is opened and until the project and the editor's code have loaded:
 * the bar, the conversation, the preview and the timeline, each where the editor puts it, as still placeholders.
 * It imports none of the editor, so it paints at once.
 */
export function EditorSkeleton() {
  return <div className="editor-skeleton dash-theme" aria-busy="true" aria-label="Opening the editor">
    <header className="editor-skeleton-bar">
      <Skeleton className="size-7" />
      <Skeleton className="h-4 w-48 max-w-[40%]" />
      <div className="editor-skeleton-bar-actions"><Skeleton className="h-8 w-[88px] rounded-full" /><Skeleton className="h-8 w-[74px] rounded-full" /><Skeleton className="size-8 rounded-full" /></div>
    </header>
    <div className="editor-skeleton-body">
      <aside className="editor-skeleton-chat">
        <Skeleton className="ml-auto h-9 w-3/5 rounded-2xl" />
        <Skeleton className="h-3 w-11/12" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-[100px] w-full rounded-xl" />
      </aside>
      <div className="editor-skeleton-work">
        <div className="editor-skeleton-tabs"><Skeleton className="size-6" /><Skeleton className="h-7 w-32" /><Skeleton className="size-7" /></div>
        <div className="editor-skeleton-stage"><Skeleton className="editor-skeleton-canvas" /></div>
        <div className="editor-skeleton-timeline"><Skeleton className="size-6" /><Skeleton className="h-3 w-20" /><Skeleton className="ml-auto size-6" /></div>
      </div>
    </div>
  </div>;
}

/** The inside of the conversation view's column while its project loads: a clip, its name and actions, then the composer. */
export function EditorChatSkeleton() {
  return <div className="editor-chat-column editor-chat-skeleton" role="status" aria-label="Loading conversation">
    <Skeleton className="h-[146px] w-[260px] max-w-full rounded-xl" />
    <Skeleton className="h-3 w-24" />
    <div className="flex gap-2"><Skeleton className="h-9 w-36 rounded-full" /><Skeleton className="h-9 w-24 rounded-full" /><Skeleton className="h-9 w-20 rounded-full" /></div>
    <Skeleton className="h-[100px] w-full rounded-xl" />
  </div>;
}
