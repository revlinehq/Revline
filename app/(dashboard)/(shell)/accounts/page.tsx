import { AccountsPage } from '@/components/posting/accounts-page';
export const metadata={title:'Connected accounts · Revline'};
export default async function AccountsRoute({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const { connected } = await searchParams;
  return <AccountsPage connected={connected} />;
}
