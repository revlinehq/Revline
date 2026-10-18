'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
export default function EditorError({reset}: {error:Error;reset:()=>void}) {return <div className="editor-boot"><h1>The editor encountered a problem.</h1><p>Try reopening the editor. Your saved project remains in Your projects.</p><Button onClick={reset}>Try again</Button><Link href="/projects">Your projects</Link></div>;}
