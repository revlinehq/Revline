import { LandingNav } from '@/components/landing/nav';
import { LandingFooter } from '@/components/landing/footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { ReactNode } from 'react';
import '@/app/landing.css';

const DRAFT = 'Draft for the owner’s legal review. Last updated November 2, 2026. Not yet approved for publication as final legal terms.';

/** The plain public page of the site: the legal texts, and other signed-out pages that pass their own `description`. */
export function LegalPage({ title, description = DRAFT, children }: { title: string; description?: string; children: ReactNode }) {
  return <main className="landing min-h-screen">
    <LandingNav />
    <section className="mx-auto max-w-3xl px-6 pb-20 pt-36">
      <Card className="border-[var(--l-border)] bg-[var(--l-bg-subtle)] text-[var(--l-fg)]">
        <CardHeader>
          <CardTitle className="text-3xl"><h1>{title}</h1></CardTitle>
          <CardDescription className="text-[var(--l-fg-2)]">{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-7 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:text-[var(--l-fg-2)] [&_a]:underline">
          {children}
        </CardContent>
      </Card>
    </section>
    <LandingFooter />
  </main>;
}
