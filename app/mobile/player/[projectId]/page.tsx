import { MobilePlayer } from '@/components/mobile/player';

export default async function MobilePlayerPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <MobilePlayer projectId={projectId} />;
}
