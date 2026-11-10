import { redirect } from 'next/navigation';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  if (checkout === 'success') redirect(`${NEW_PROJECT_PATH}?checkout=success`);
  if (checkout === 'canceled') redirect(NEW_PROJECT_PATH);
  redirect('/profile#billing');
}
