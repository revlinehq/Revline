import { redirect } from 'next/navigation';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

export default async function LegacyChatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  redirect(`${NEW_PROJECT_PATH}${params.size ? `?${params}` : ''}`);
}
