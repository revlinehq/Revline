import { redirect } from 'next/navigation';

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const query = checkout === 'success' || checkout === 'canceled' ? `?checkout=${checkout}` : '';
  redirect(`/profile${query}#billing`);
}
