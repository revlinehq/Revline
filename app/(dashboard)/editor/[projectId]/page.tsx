import { auth } from '@clerk/nextjs/server';
import { ConnectedEditor } from '@/components/editor/connected-editor';
import '@/app/editor.css';
export default async function EditorPage({params}: {params:Promise<{projectId:string}>}) { await auth.protect(); const {projectId}=await params; return <ConnectedEditor key={projectId} projectId={projectId} />; }
