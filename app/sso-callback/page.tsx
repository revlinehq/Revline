import { Suspense } from 'react';
import { SsoCallback } from '@/components/auth/sso-callback';
import '@/app/auth.css';

export default function SsoCallbackPage() {
  return <Suspense><SsoCallback /></Suspense>;
}
