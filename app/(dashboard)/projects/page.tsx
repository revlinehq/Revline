import { redirect } from 'next/navigation';

/** The retired project list now lives with the conversation history. */
export default function ProjectsPage() { redirect('/chats'); }
