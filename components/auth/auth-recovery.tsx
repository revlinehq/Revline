'use client';

import { useEffect, useState } from 'react';

export function AuthRecovery() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 20_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!slow) return null;

  return <div className="auth-recovery" role="status">
    <p>Sign-in is taking longer than expected. Reload this page to try again.</p>
    <button type="button" onClick={() => window.location.reload()}>Reload page</button>
    <p>If it keeps happening, try a private window or clear site data for Revline in your browser settings.</p>
  </div>;
}
