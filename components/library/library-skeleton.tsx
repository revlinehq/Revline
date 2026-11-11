import { Skeleton } from '@/components/ui/skeleton';
import './library.css';

const still = 'animate-none';
export function FolderTilesSkeleton({ count = 4 }: { count?: number }) {
  return <div className="library-folders" aria-hidden="true">{Array.from({ length: count }, (_, index) => <div key={index} className="library-folder library-folder-skeleton">
    <div className="library-folder-top"><Skeleton className={`${still} h-6 w-7`} /><Skeleton className={`${still} h-[26px] w-[70px]`} /></div>
    <Skeleton className={`${still} h-4 w-24`} /><Skeleton className={`${still} mt-2 h-3 w-28`} />
  </div>)}</div>;
}
export function FileTilesSkeleton({ count = 8 }: { count?: number }) {
  return <div className="library-files" aria-hidden="true">{Array.from({ length: count }, (_, index) => <div key={index} className="library-file">
    <Skeleton className={`${still} library-file-thumb`} />
    <Skeleton className={`${still} mt-3 h-4 w-3/4`} /><Skeleton className={`${still} mt-2 h-3 w-1/2`} />
  </div>)}</div>;
}
export function FileRowsSkeleton({ count = 6 }: { count?: number }) {
  return <div className="library-table-card" aria-hidden="true">{Array.from({ length: count }, (_, index) => <div key={index} className="library-row-skeleton">
    <Skeleton className={`${still} size-4`} /><Skeleton className={`${still} h-[26px] w-[46px]`} /><Skeleton className={`${still} h-4 w-2/5`} /><Skeleton className={`${still} ml-auto h-3 w-16`} />
  </div>)}</div>;
}
/** The Library page before its data arrives: the toolbar's frame, a row of folder tiles and a grid of file tiles. */
export function LibrarySkeleton() {
  return <main className="dash-content library-page" aria-busy="true">
    <div className="library-head"><Skeleton className={`${still} h-5 w-20`} /><Skeleton className={`${still} ml-auto h-3 w-28`} /></div>
    <div className="library-toolbar"><Skeleton className={`${still} library-search h-9`} /><Skeleton className={`${still} ml-auto h-9 w-[104px]`} /><Skeleton className={`${still} h-9 w-[76px]`} /><Skeleton className={`${still} h-9 w-[124px]`} /><Skeleton className={`${still} h-9 w-[100px]`} /></div>
    <div className="library-section-head"><Skeleton className={`${still} h-4 w-16`} /></div>
    <FolderTilesSkeleton />
    <div className="library-section-head"><Skeleton className={`${still} h-4 w-24`} /></div>
    <FileTilesSkeleton />
    <span className="sr-only" role="status">Loading your Library…</span>
  </main>;
}
