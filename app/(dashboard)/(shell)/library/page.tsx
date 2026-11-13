import { Suspense } from 'react';
import { LibraryPage } from '@/components/library/library-page';
import { LibraryPageLoading } from '@/components/library/library-loading';

export const metadata = { title: 'Library · Revline' };
// The open folder is read from the address, so the page waits for it behind its own frame.
export default function LibraryRoute() { return <Suspense fallback={<LibraryPageLoading />}><LibraryPage /></Suspense>; }
