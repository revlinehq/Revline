import { ProfilePage } from '@/components/workspace/profile-page';

export default async function ProfileRoute({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  return <ProfilePage checkoutReturn={checkout === 'success' || checkout === 'canceled' ? checkout : undefined} />;
}
