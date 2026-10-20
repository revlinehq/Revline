import type { Id } from '@/convex/_generated/dataModel';

/** Both import entry points attach JPEGs through the same owned upload flow. */
export async function uploadMediaThumbnail(image: Blob, transport: {
  uploadUrl: () => Promise<string>;
  attach: (storageId: Id<'_storage'>) => Promise<unknown>;
}): Promise<void> {
  const response = await fetch(await transport.uploadUrl(), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: image });
  if (!response.ok) throw new Error('Could not save the footage thumbnail.');
  const { storageId } = await response.json() as { storageId: Id<'_storage'> };
  await transport.attach(storageId);
}
