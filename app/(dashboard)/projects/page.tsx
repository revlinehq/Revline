import { redirect } from 'next/navigation';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

export default function ProjectsPage() { redirect(NEW_PROJECT_PATH); }
