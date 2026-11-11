'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export function AuthRecovery() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 20_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!slow) return null;

  return <div className="auth-recovery" role="status">
    <p>Sign-in is taking longer than expected. Reload this page to try again.</p>
    <Button variant="soft" type="button" onClick={() => window.location.reload()}>Reload page</Button>
    <p>If it keeps happening, try a private window or clear site data for Revline in your browser settings.</p>
  </div>;
}
