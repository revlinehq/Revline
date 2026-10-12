'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
export default function EditorError({reset}: {error:Error;reset:()=>void}) {return <div className="editor-boot"><h1>This project could not be opened.</h1><p>Check that you’re signed into the account that owns it.</p><Button onClick={reset}>Try again</Button><Link href="/projects">Your projects</Link></div>;}
