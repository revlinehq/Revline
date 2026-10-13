/** Add only real licensed overlay sources. Catalog IDs need import before timeline insertion. */
export type OverlayCatalogItem = {
  id: string; title: string; kind: 'video' | 'image'; previewUrl: string; sourceUrl: string;
  license: string; attribution?: string;
};
export const OVERLAY_CATALOG: readonly OverlayCatalogItem[] = [];
