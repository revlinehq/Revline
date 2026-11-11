import type { Metadata } from 'next';
import { NEW_WORKSPACE_LABEL } from '@/lib/editor/workspace-labels';
import { NewProjectPage } from '@/components/workspace/new-project-page';

export const metadata: Metadata = { title: `${NEW_WORKSPACE_LABEL} · Revline` };

export default function NewProjectRoute() { return <NewProjectPage />; }
