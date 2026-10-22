'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';
import { captureClientException } from '@/lib/monitoring/client';
import { isProjectNotFound } from '@/lib/user-error';
export default function EditorError({error,reset}: {error:Error;reset:()=>void}) {
  const missing=isProjectNotFound(error);
  useEffect(() => { if(!missing)captureClientException(error); }, [error,missing]);
  if(missing)return <div className="editor-boot"><h1>Project not found.</h1><p>This project may have been deleted, or the link may be incorrect.</p><Button asChild><Link href="/chats">Your projects</Link></Button></div>;
  return <div className="editor-boot"><h1>The editor encountered a problem.</h1><p>Try reopening the editor. Your saved project remains in Your projects.</p><Button onClick={reset}>Try again</Button><Link href="/chats">Your projects</Link></div>;
}
