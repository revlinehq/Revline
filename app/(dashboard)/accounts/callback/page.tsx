import { ConnectCallback } from '@/components/posting/connect-callback';
export const metadata={title:'Connecting account · Revline'};
export default async function AccountsCallbackRoute({ searchParams }: { searchParams: Promise<{ code?: string; state?: string; error?: string }> }) {
  const { code, state, error } = await searchParams;
  return <ConnectCallback code={code} state={state} refused={!!error} />;
}
