"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function SharinganRedirect() {
  const router = useRouter();
  useEffect(() => {
    // Keep the initial response crawlable; only browsers navigate to the film.
    router.replace('/#inspo');
  }, [router]);

  return <main className="flex min-h-screen items-center justify-center bg-[#121212] text-white">
    <Button asChild variant="link" className="text-white focus-visible:ring-0">
      <Link href="/#inspo">Watch Revline Sharingan</Link>
    </Button>
  </main>;
}
