import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/auth-form';
import '@/app/auth.css';

export default function SignInPage() {
  return <Suspense><AuthForm /></Suspense>;
}
